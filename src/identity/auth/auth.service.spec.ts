import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;
  let redis: any;
  let emailQueue: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-jwt-token'),
      verifyAsync: jest.fn(),
    };

    redis = {
      setex: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      expire: jest.fn().mockResolvedValue(1),
    };

    emailQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          JWT_SECRET: 'test-secret',
          REFRESH_SECRET: 'test-refresh-secret',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getQueueToken('email'), useValue: emailQueue },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should normalize email, hash password, and queue verification & welcome emails', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u-1',
        email: 'user@example.com',
        firstName: 'Rahim',
        lastName: 'Uddin',
        phone: '01700000000',
        role: Role.USER,
        emailVerified: false,
      });

      const res = await service.register({
        firstName: 'Rahim',
        lastName: 'Uddin',
        email: '  USER@Example.COM ',
        phone: '01700000000',
        password: 'StrongPassword123!',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
      expect(emailQueue.add).toHaveBeenCalledTimes(2);
      expect(res.user.email).toBe('user@example.com');
    });

    it('should throw ConflictException if email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.register({
          firstName: 'Rahim',
          lastName: 'Uddin',
          email: 'user@example.com',
          password: 'StrongPassword123!',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should reject soft-deleted user', async () => {
      const passwordHash = await bcrypt.hash('Password123!', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'user@example.com',
        password: passwordHash,
        deletedAt: new Date(),
        isSuspended: false,
      });

      await expect(
        service.login({ email: 'user@example.com', password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException if user is suspended', async () => {
      const passwordHash = await bcrypt.hash('Password123!', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'user@example.com',
        password: passwordHash,
        deletedAt: null,
        isSuspended: true,
      });

      await expect(
        service.login({ email: 'user@example.com', password: 'Password123!' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should store hashed refresh token in Redis session set and return user + tokens', async () => {
      const passwordHash = await bcrypt.hash('Password123!', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'user@example.com',
        firstName: 'Rahim',
        lastName: 'Uddin',
        phone: null,
        role: Role.USER,
        emailVerified: false,
        walletBalanceBdt: 0,
        resellerDiscount: 0,
        isSuspended: false,
        deletedAt: null,
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.login({
        email: 'USER@Example.com',
        password: 'Password123!',
      });

      expect(res.user.email).toBe('user@example.com');
      expect(res.tokens.accessToken).toBe('signed-jwt-token');
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^refresh_token:u-1:/),
        604800,
        expect.any(String),
      );
      expect(redis.sadd).toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('should throw BadRequestException if current password is wrong', async () => {
      const passwordHash = await bcrypt.hash('OldPass123!', 4);
      prisma.user.findFirst.mockResolvedValue({
        id: 'u-1',
        password: passwordHash,
        isSuspended: false,
      });

      await expect(
        service.changePassword('u-1', {
          currentPassword: 'WrongPass123!',
          newPassword: 'NewStrongPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update password, write audit log, and revoke all sessions', async () => {
      const passwordHash = await bcrypt.hash('OldPass123!', 4);
      prisma.user.findFirst.mockResolvedValue({
        id: 'u-1',
        email: 'user@example.com',
        password: passwordHash,
        isSuspended: false,
      });
      redis.smembers.mockResolvedValue(['sid-1']);

      const res = await service.changePassword('u-1', {
        currentPassword: 'OldPass123!',
        newPassword: 'NewStrongPassword123!',
      });

      expect(prisma.user.update).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
      expect(redis.setex).toHaveBeenCalledWith(
        'user_revoked_before:u-1',
        900,
        expect.any(String),
      );
      expect(res.message).toContain('Password changed successfully');
    });
  });

  describe('resetPassword', () => {
    it('should fallback to DB when Redis has no reset token', async () => {
      const rawToken = 'reset-uuid-token';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      redis.get.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue({
        id: 'u-1',
        email: 'user@example.com',
        deletedAt: null,
        isSuspended: false,
        resetToken: tokenHash,
        resetTokenExpiry: new Date(Date.now() + 60000),
      });

      const res = await service.resetPassword({
        token: rawToken,
        password: 'NewStrongPassword123!',
      });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          resetToken: tokenHash,
          deletedAt: null,
        }),
      });
      expect(prisma.user.update).toHaveBeenCalled();
      expect(res.message).toContain('reset successfully');
    });
  });
});
