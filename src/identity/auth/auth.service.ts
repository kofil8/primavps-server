import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonWebTokenError, JwtService, TokenExpiredError } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Queue } from 'bullmq';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  emailVerified: true,
  walletBalanceBdt: true,
  resellerDiscount: true,
  isSuspended: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly resetTokenExpiryMs = 60 * 60 * 1000; // 1 hour
  private readonly sevenDaysInSeconds = 7 * 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

  async register(data: RegisterUserDto) {
    const email = this.normalizeEmail(data.email);
    await this.ensureUserDoesNotExist(email);
    const hashedPassword = await this.hashPassword(data.password);

    const emailVerificationToken = randomUUID();
    const emailVerificationTokenExpiry = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    const user = await this.prisma.user.create({
      data: {
        email,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone?.trim() || null,
        password: hashedPassword,
        role: Role.USER,
        emailVerificationToken,
        emailVerificationTokenExpiry,
      },
      select: SAFE_USER_SELECT,
    });

    await Promise.all([
      this.emailQueue.add('verify-email', {
        to: user.email,
        verificationToken: emailVerificationToken,
      }),
      this.emailQueue.add('welcome', {
        to: user.email,
        name: user.firstName,
      }),
    ]);

    this.logger.log(
      `User registered: ${user.email}. Verification email queued.`,
    );

    return {
      user,
      message:
        'User registered successfully. Please check your email to verify your account.',
    };
  }

  async login(data: LoginUserDto) {
    const email = this.normalizeEmail(data.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (
      !user ||
      user.deletedAt !== null ||
      !(await this.verifyPassword(data.password, user.password))
    ) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (user.isSuspended) {
      throw new ForbiddenException(
        'Your account has been suspended. Please contact support.',
      );
    }

    const sessionId = randomUUID();
    const tokens = await this.generateTokens(user, sessionId);
    await this.storeRefreshSession(user.id, sessionId, tokens.refreshToken);

    const safeUser = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      emailVerified: user.emailVerified,
      walletBalanceBdt: user.walletBalanceBdt,
      resellerDiscount: user.resellerDiscount,
      isSuspended: user.isSuspended,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return { user: safeUser, tokens };
  }

  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required.');
    }

    let payload: { sub: string; sid?: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get<string>('REFRESH_SECRET'),
      });
    } catch (error) {
      if (
        error instanceof TokenExpiredError ||
        error instanceof JsonWebTokenError
      ) {
        throw new UnauthorizedException('Invalid refresh token.');
      }
      throw error;
    }

    if (!payload.sid) {
      throw new UnauthorizedException('Invalid refresh token session.');
    }

    const sessionKey = this.sessionKey(payload.sub, payload.sid);
    const cachedHash = await this.redis.get(sessionKey);
    const incomingHash = this.hashToken(refreshToken);

    if (!cachedHash || !this.safeCompare(cachedHash, incomingHash)) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.deletedAt !== null) {
      await this.revokeAllUserSessions(payload.sub);
      throw new UnauthorizedException('User no longer exists.');
    }

    if (user.isSuspended) {
      await this.revokeAllUserSessions(user.id);
      throw new ForbiddenException(
        'Your account has been suspended. Please contact support.',
      );
    }

    // Rotate session ID on refresh
    const nextSessionId = randomUUID();
    const tokens = await this.generateTokens(user, nextSessionId);

    await Promise.all([
      this.redis.del(sessionKey),
      this.redis.srem(this.userSessionsSetKey(user.id), payload.sid),
      this.storeRefreshSession(user.id, nextSessionId, tokens.refreshToken),
    ]);

    return tokens;
  }

  async forgotPassword(data: ForgotPasswordDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(data.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Always return success to prevent email enumeration
    if (!user || user.deletedAt !== null || user.isSuspended) {
      return { message: 'If that email exists, a reset link has been sent.' };
    }

    const resetToken = randomUUID();
    const tokenHash = this.hashToken(resetToken);
    const expiry = new Date(Date.now() + this.resetTokenExpiryMs);

    await Promise.all([
      this.redis.setex(
        `reset_token:${tokenHash}`,
        this.resetTokenExpiryMs / 1000,
        user.id,
      ),
      this.prisma.user.update({
        where: { id: user.id },
        data: { resetToken: tokenHash, resetTokenExpiry: expiry },
      }),
    ]);

    this.logger.log(`Password reset requested for ${email}`);

    await this.emailQueue.add('password-reset', {
      to: user.email,
      resetToken,
    });

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(data: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(data.token);
    let userId = await this.redis.get(`reset_token:${tokenHash}`);

    let user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : null;

    // DB fallback if Redis cache was flushed/restarted
    if (!user) {
      user = await this.prisma.user.findFirst({
        where: {
          resetToken: tokenHash,
          resetTokenExpiry: { gt: new Date() },
          deletedAt: null,
        },
      });
      userId = user?.id ?? null;
    }

    if (!user || !userId || user.deletedAt !== null) {
      throw new BadRequestException('Invalid or expired reset token.');
    }

    if (user.isSuspended) {
      throw new ForbiddenException(
        'Your account has been suspended. Please contact support.',
      );
    }

    if (user.resetTokenExpiry && new Date() > user.resetTokenExpiry) {
      throw new BadRequestException('Reset token has expired.');
    }

    const hashedPassword = await this.hashPassword(data.password);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    await Promise.all([
      this.revokeAllUserSessions(user.id),
      this.redis.del(`reset_token:${tokenHash}`),
    ]);

    this.logger.log(`Password reset completed for ${user.email}`);

    return { message: 'Password has been reset successfully.' };
  }

  async changePassword(
    userId: string,
    data: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('Account is suspended.');
    }

    const isCurrentValid = await this.verifyPassword(
      data.currentPassword,
      user.password,
    );
    if (!isCurrentValid) {
      throw new BadRequestException('Current password is incorrect.');
    }

    const isSamePassword = await this.verifyPassword(
      data.newPassword,
      user.password,
    );
    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from your current password.',
      );
    }

    const hashedPassword = await this.hashPassword(data.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'PASSWORD_CHANGED',
          entity: 'User',
          entityId: user.id,
        },
      }),
    ]);

    await this.revokeAllUserSessions(user.id);

    this.logger.log(`Password changed for user ${user.email}`);

    return {
      message: 'Password changed successfully. Please log in again.',
    };
  }

  async verifyEmail(data: VerifyEmailDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({
      where: {
        emailVerificationToken: data.token,
        emailVerificationTokenExpiry: { gt: new Date() },
        deletedAt: null,
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token.');
    }

    if (user.emailVerified) {
      return { message: 'Email is already verified.' };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationTokenExpiry: null,
      },
    });

    this.logger.log(`Email verified for user: ${user.email}`);

    return { message: 'Email verified successfully.' };
  }

  async resendVerification(
    data: ResendVerificationDto,
  ): Promise<{ message: string }> {
    const email = this.normalizeEmail(data.email);
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });

    if (!user || user.isSuspended || user.emailVerified) {
      return {
        message:
          'If your account requires verification, a new verification email has been sent.',
      };
    }

    const emailVerificationToken = randomUUID();
    const emailVerificationTokenExpiry = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken,
        emailVerificationTokenExpiry,
      },
    });

    await this.emailQueue.add('verify-email', {
      to: user.email,
      verificationToken: emailVerificationToken,
    });

    return {
      message:
        'If your account requires verification, a new verification email has been sent.',
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: SAFE_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      try {
        const payload = await this.jwtService.verifyAsync<{
          sub: string;
          sid?: string;
        }>(refreshToken, {
          secret: this.configService.get<string>('REFRESH_SECRET'),
        });
        if (payload.sub === userId && payload.sid) {
          await Promise.all([
            this.redis.del(this.sessionKey(userId, payload.sid)),
            this.redis.srem(this.userSessionsSetKey(userId), payload.sid),
          ]);
          return;
        }
      } catch {
        // Ignore expired/invalid refresh token on logout
      }
    }

    await this.revokeAllUserSessions(userId);
  }

  async logoutAll(userId: string): Promise<{ message: string }> {
    await this.revokeAllUserSessions(userId);
    return { message: 'Logged out from all devices successfully.' };
  }

  private async storeRefreshSession(
    userId: string,
    sessionId: string,
    refreshToken: string,
  ) {
    const tokenHash = this.hashToken(refreshToken);
    const setKey = this.userSessionsSetKey(userId);
    await Promise.all([
      this.redis.setex(
        this.sessionKey(userId, sessionId),
        this.sevenDaysInSeconds,
        tokenHash,
      ),
      this.redis.sadd(setKey, sessionId),
      this.redis.expire(setKey, this.sevenDaysInSeconds),
    ]);
  }

  private async revokeAllUserSessions(userId: string): Promise<void> {
    const setKey = this.userSessionsSetKey(userId);
    const sessionIds = await this.redis.smembers(setKey);
    const keysToDelete = [
      setKey,
      ...sessionIds.map((sid) => this.sessionKey(userId, sid)),
    ];

    const revokedBeforeSec = Math.floor(Date.now() / 1000);
    await Promise.all([
      keysToDelete.length > 0 ? this.redis.del(...keysToDelete) : Promise.resolve(0),
      this.redis.setex(
        `user_revoked_before:${userId}`,
        900, // 15m access token TTL
        revokedBeforeSec.toString(),
      ),
    ]);
  }

  private sessionKey(userId: string, sessionId: string): string {
    return `refresh_token:${userId}:${sessionId}`;
  }

  private userSessionsSetKey(userId: string): string {
    return `user_sessions:${userId}`;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  private async ensureUserDoesNotExist(email: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException(`User with email ${email} already exists.`);
    }
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt();
    return bcrypt.hash(password, salt);
  }

  private async verifyPassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  private async generateTokens(
    user: {
      id: string;
      email: string;
      role: string;
    },
    sessionId: string,
  ) {
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(user),
      this.generateRefreshToken(user, sessionId),
    ]);
    return { accessToken, refreshToken };
  }

  private async generateAccessToken(user: {
    id: string;
    email: string;
    role: string;
  }) {
    const payload = { email: user.email, sub: user.id, role: user.role };
    return this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '15m',
    });
  }

  private async generateRefreshToken(
    user: {
      id: string;
    },
    sessionId: string,
  ) {
    return this.jwtService.signAsync(
      { sub: user.id, sid: sessionId },
      {
        secret: this.configService.get<string>('REFRESH_SECRET'),
        expiresIn: '7d',
      },
    );
  }
}
