import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let userService: UserService;
  let prisma: any;
  let redis: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((arg) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };

    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    }).compile();

    userService = moduleRef.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(userService).toBeDefined();
  });

  describe('findUserById (RBAC & IDOR protection)', () => {
    it('should forbid a USER from reading another user profile', async () => {
      await expect(
        userService.findUserById('user-2', {
          sub: 'user-1',
          email: 'u1@example.com',
          role: Role.USER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow SUPPORT to read any active user profile', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', role: Role.USER });

      const user = await userService.findUserById('user-2', {
        sub: 'support-1',
        email: 'sup@example.com',
        role: Role.SUPPORT,
      });

      expect(user.id).toBe('user-2');
    });
  });

  describe('createUser (Hierarchy)', () => {
    it('should forbid ADMIN from creating an ADMIN or SUPER_ADMIN user', async () => {
      await expect(
        userService.createUser(
          {
            email: 'newadmin@example.com',
            firstName: 'New',
            lastName: 'Admin',
            password: 'StrongPassword123!',
            role: Role.ADMIN,
          },
          { sub: 'admin-1', email: 'a@example.com', role: Role.ADMIN },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow SUPER_ADMIN to create an ADMIN user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'new-admin',
        email: 'newadmin@example.com',
        role: Role.ADMIN,
      });

      const created = await userService.createUser(
        {
          email: 'NewAdmin@Example.com',
          firstName: 'New',
          lastName: 'Admin',
          password: 'StrongPassword123!',
          role: Role.ADMIN,
        },
        { sub: 'super-1', email: 'sa@example.com', role: Role.SUPER_ADMIN },
      );

      expect(created.role).toBe(Role.ADMIN);
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('updateUserById (Suspension & Hierarchy)', () => {
    it('should forbid USER from setting role or isSuspended', async () => {
      await expect(
        userService.updateUserById(
          'user-1',
          { role: Role.ADMIN },
          { sub: 'user-1', email: 'u1@example.com', role: Role.USER },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should block user in Redis when ADMIN suspends a USER', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'u1@example.com',
        role: Role.USER,
      });
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        isSuspended: true,
      });

      await userService.updateUserById(
        'user-1',
        { isSuspended: true },
        { sub: 'admin-1', email: 'a@example.com', role: Role.ADMIN },
      );

      expect(redis.set).toHaveBeenCalledWith('user_blocked:user-1', '1');
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('adjustWallet', () => {
    it('should throw BadRequestException if debit causes negative balance', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        role: Role.USER,
        walletBalanceBdt: 200,
      });

      await expect(
        userService.adjustWallet(
          'user-1',
          { amountDeltaBdt: -500, reason: 'Manual deduction' },
          { sub: 'admin-1', email: 'a@example.com', role: Role.ADMIN },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should increment walletBalanceBdt and create AuditLog', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        role: Role.USER,
        walletBalanceBdt: 200,
      });
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        walletBalanceBdt: 700,
      });

      const res = await userService.adjustWallet(
        'user-1',
        { amountDeltaBdt: 500, reason: 'Refund credit' },
        { sub: 'admin-1', email: 'a@example.com', role: Role.ADMIN },
      );

      expect(res.walletBalanceBdt).toBe(700);
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });
  });
});
