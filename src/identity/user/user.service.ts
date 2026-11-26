import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type Redis from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { UpdateProfileDto, UpdateUserDto } from './dto/update-user.dto';

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  walletBalanceBdt: true,
  resellerDiscount: true,
  isSuspended: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ALLOWED_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'email',
  'firstName',
  'lastName',
  'role',
  'walletBalanceBdt',
]);

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
  ) {}

  async existsActiveUser(id: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return Boolean(user);
  }

  async createUser(dto: CreateUserDto, currentUser: JwtPayload) {
    const targetRole = dto.role ?? Role.USER;
    this.ensureCanAssignRole(currentUser.role as Role, targetRole);

    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(`User with email ${email} already exists.`);
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone: dto.phone?.trim() || null,
          password: hashedPassword,
          role: targetRole,
          resellerDiscount: dto.resellerDiscount ?? 0,
          emailVerified: dto.emailVerified ?? true,
        },
        select: SAFE_USER_SELECT,
      });

      await tx.auditLog.create({
        data: {
          actorId: currentUser.sub,
          action: 'USER_CREATED',
          entity: 'User',
          entityId: created.id,
          metadata: { role: created.role, email: created.email },
        },
      });

      return created;
    });
  }

  async findAllUsers(query: FindUsersQueryDto) {
    const {
      search,
      role,
      isSuspended,
      emailVerified,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;
    const safeSortBy = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : 'createdAt';

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(role ? { role } : {}),
      ...(isSuspended !== undefined ? { isSuspended } : {}),
      ...(emailVerified !== undefined ? { emailVerified } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        where,
        orderBy: { [safeSortBy]: sortOrder },
        select: SAFE_USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findUserById(id: string, currentUser?: JwtPayload) {
    if (currentUser) {
      this.ensureReadAccess(id, currentUser);
    }

    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: SAFE_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found.`);
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!target) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    const data = await this.buildProfileUpdateData(target, dto, false);
    if (Object.keys(data).length === 0) {
      return this.findUserById(userId);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: SAFE_USER_SELECT,
    });
  }

  async updateUserById(
    id: string,
    dto: UpdateUserDto,
    currentUser: JwtPayload,
  ) {
    const actorRole = currentUser.role as Role;
    const isOwner = currentUser.sub === id;
    const isAdminOrSuper =
      actorRole === Role.ADMIN || actorRole === Role.SUPER_ADMIN;

    if (!isOwner && !isAdminOrSuper) {
      throw new ForbiddenException(
        'You do not have permission to update this user.',
      );
    }

    const hasAdminFields =
      dto.role !== undefined ||
      dto.isSuspended !== undefined ||
      dto.resellerDiscount !== undefined ||
      dto.emailVerified !== undefined;

    if (hasAdminFields && !isAdminOrSuper) {
      throw new ForbiddenException(
        'Only administrators can modify role, suspension, discount, or verification status.',
      );
    }

    const target = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target) {
      throw new NotFoundException(`User with ID ${id} not found.`);
    }

    // Strict hierarchy: ADMIN cannot modify ADMIN or SUPER_ADMIN (except own profile fields)
    if (!isOwner) {
      this.ensureCanManageTarget(actorRole, target.role);
    } else if (hasAdminFields && actorRole === Role.ADMIN) {
      throw new ForbiddenException(
        'Administrators cannot modify their own privileged fields.',
      );
    }

    if (dto.role !== undefined) {
      this.ensureCanAssignRole(actorRole, dto.role);
    }

    if (isOwner && dto.isSuspended === true) {
      throw new BadRequestException('You cannot suspend your own account.');
    }

    const data = await this.buildProfileUpdateData(target, dto, isAdminOrSuper);

    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isSuspended !== undefined) data.isSuspended = dto.isSuspended;
    if (dto.resellerDiscount !== undefined) {
      data.resellerDiscount = dto.resellerDiscount;
    }
    if (dto.emailVerified !== undefined) data.emailVerified = dto.emailVerified;

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data,
        select: SAFE_USER_SELECT,
      });

      if (hasAdminFields) {
        await tx.auditLog.create({
          data: {
            actorId: currentUser.sub,
            action: 'USER_UPDATED_BY_ADMIN',
            entity: 'User',
            entityId: id,
            metadata: {
              role: dto.role,
              isSuspended: dto.isSuspended,
              resellerDiscount: dto.resellerDiscount,
              emailVerified: dto.emailVerified,
            },
          },
        });
      }

      return user;
    });

    if (dto.isSuspended === true) {
      await this.blockAndRevokeUser(id);
    } else if (dto.isSuspended === false) {
      await this.unblockUser(id);
    }

    return updated;
  }

  async adjustWallet(
    id: string,
    dto: AdjustWalletDto,
    currentUser: JwtPayload,
  ) {
    const actorRole = currentUser.role as Role;
    if (actorRole !== Role.ADMIN && actorRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only administrators can adjust wallets.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id, deletedAt: null },
      });
      if (!target) {
        throw new NotFoundException(`User with ID ${id} not found.`);
      }

      this.ensureCanManageTarget(actorRole, target.role);

      const nextBalance = target.walletBalanceBdt + dto.amountDeltaBdt;
      if (nextBalance < 0) {
        throw new BadRequestException(
          `Insufficient wallet balance. Current: ${target.walletBalanceBdt} BDT.`,
        );
      }

      const user = await tx.user.update({
        where: { id },
        data: { walletBalanceBdt: { increment: dto.amountDeltaBdt } },
        select: SAFE_USER_SELECT,
      });

      await tx.auditLog.create({
        data: {
          actorId: currentUser.sub,
          action: 'WALLET_ADJUSTED',
          entity: 'User',
          entityId: id,
          metadata: {
            beforeBdt: target.walletBalanceBdt,
            deltaBdt: dto.amountDeltaBdt,
            afterBdt: user.walletBalanceBdt,
            reason: dto.reason,
          },
        },
      });

      return user;
    });

    return updated;
  }

  async deleteUserById(id: string, currentUser: JwtPayload): Promise<void> {
    const actorRole = currentUser.role as Role;
    const isOwner = currentUser.sub === id;
    const isAdminOrSuper =
      actorRole === Role.ADMIN || actorRole === Role.SUPER_ADMIN;

    if (!isOwner && !isAdminOrSuper) {
      throw new ForbiddenException(
        'You do not have permission to delete this user.',
      );
    }

    const target = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target) {
      throw new NotFoundException(`User with ID ${id} not found.`);
    }

    if (!isOwner) {
      this.ensureCanManageTarget(actorRole, target.role);
    } else if (actorRole === Role.SUPER_ADMIN) {
      throw new BadRequestException(
        'SUPER_ADMIN accounts cannot be self-deleted.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: currentUser.sub,
          action: 'USER_DELETED',
          entity: 'User',
          entityId: id,
          metadata: { deletedEmail: target.email, selfDelete: isOwner },
        },
      }),
    ]);

    await this.blockAndRevokeUser(id);
  }

  private async buildProfileUpdateData(
    target: { id: string; email: string },
    dto: UpdateProfileDto | UpdateUserDto,
    isAdminOverride: boolean,
  ): Promise<Prisma.UserUpdateInput> {
    const data: Prisma.UserUpdateInput = {};

    if (dto.email !== undefined) {
      const normalizedEmail = dto.email.trim().toLowerCase();
      if (normalizedEmail !== target.email) {
        const conflict = await this.prisma.user.findUnique({
          where: { email: normalizedEmail },
        });
        if (conflict && conflict.id !== target.id) {
          throw new ConflictException(
            `User with email ${normalizedEmail} already exists.`,
          );
        }
        data.email = normalizedEmail;
        if (!isAdminOverride) {
          data.emailVerified = false;
        }
      }
    }

    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null;

    return data;
  }

  private ensureReadAccess(resourceId: string, currentUser: JwtPayload) {
    const role = currentUser.role as Role;
    const isStaff =
      role === Role.SUPER_ADMIN ||
      role === Role.ADMIN ||
      role === Role.SUPPORT;
    const isOwner = currentUser.sub === resourceId;

    if (!isOwner && !isStaff) {
      throw new ForbiddenException(
        'You do not have permission to view this user.',
      );
    }
  }

  private ensureCanManageTarget(actorRole: Role, targetRole: Role) {
    if (actorRole === Role.SUPER_ADMIN) return;
    if (
      actorRole === Role.ADMIN &&
      (targetRole === Role.ADMIN || targetRole === Role.SUPER_ADMIN)
    ) {
      throw new ForbiddenException(
        'Administrators cannot manage ADMIN or SUPER_ADMIN accounts.',
      );
    }
  }

  private ensureCanAssignRole(actorRole: Role, newRole: Role) {
    if (actorRole === Role.SUPER_ADMIN) return;
    if (
      actorRole === Role.ADMIN &&
      (newRole === Role.ADMIN || newRole === Role.SUPER_ADMIN)
    ) {
      throw new ForbiddenException(
        'Only SUPER_ADMIN can assign ADMIN or SUPER_ADMIN roles.',
      );
    }
  }

  private async blockAndRevokeUser(userId: string) {
    if (!this.redis) return;
    const setKey = `user_sessions:${userId}`;
    const sessionIds = await this.redis.smembers(setKey);
    const keysToDelete = [
      setKey,
      ...sessionIds.map((sid) => `refresh_token:${userId}:${sid}`),
    ];

    await Promise.all([
      keysToDelete.length > 0 ? this.redis.del(...keysToDelete) : Promise.resolve(0),
      this.redis.set(`user_blocked:${userId}`, '1'),
    ]);
  }

  private async unblockUser(userId: string) {
    if (!this.redis) return;
    await this.redis.del(`user_blocked:${userId}`);
  }
}
