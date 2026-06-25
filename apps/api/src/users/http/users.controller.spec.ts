/**
 * UsersController Unit Tests
 *
 * @module apps/api/src/users/http
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import {
  USER_MANAGEMENT_SERVICE_TOKEN,
  type IUserManagementService,
} from '../user-management.service.interface';
import {
  User,
  UserNotFoundException,
  UserNotActiveException,
  UserNotDeactivatedException,
  UserNotPendingException,
} from '@openlinker/core/users';

const makeUser = (id: string, status: 'pending' | 'active' | 'deactivated' = 'active'): User =>
  new User(id, `user-${id}`, `${id}@test.com`, 'hash', 'viewer', status, new Date(), new Date());

const makeService = (): jest.Mocked<IUserManagementService> => ({
  listUsers: jest.fn(),
  approveUser: jest.fn(),
  rejectUser: jest.fn(),
  updateRole: jest.fn(),
  deactivateUser: jest.fn(),
  reactivateUser: jest.fn(),
  deleteUser: jest.fn(),
});

describe('UsersController', () => {
  let controller: UsersController;
  let service: jest.Mocked<IUserManagementService>;

  beforeEach(async () => {
    service = makeService();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: USER_MANAGEMENT_SERVICE_TOKEN, useValue: service }],
    }).compile();
    controller = module.get(UsersController);
  });

  describe('listUsers', () => {
    it('should return mapped user list for a valid status filter', async () => {
      service.listUsers.mockResolvedValue({ users: [makeUser('u1')], total: 1 });

      const result = await controller.listUsers({ status: 'active' });

      expect(service.listUsers).toHaveBeenCalledWith({
        status: 'active',
        page: undefined,
        pageSize: undefined,
      });
      expect(result.total).toBe(1);
      expect(result.users).toHaveLength(1);
    });

    it('should pass page and pageSize when provided', async () => {
      service.listUsers.mockResolvedValue({ users: [], total: 0 });

      await controller.listUsers({ status: undefined, page: 0, pageSize: 10 });

      expect(service.listUsers).toHaveBeenCalledWith({
        status: undefined,
        page: 0,
        pageSize: 10,
      });
    });
  });

  describe('approveUser', () => {
    it('should call service.approveUser with id and role', async () => {
      service.approveUser.mockResolvedValue(undefined);

      await controller.approveUser('u1', { role: 'admin' });

      expect(service.approveUser).toHaveBeenCalledWith('u1', 'admin');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      service.approveUser.mockRejectedValue(new UserNotFoundException('u1'));

      await expect(controller.approveUser('u1', { role: 'viewer' })).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException when user is not pending', async () => {
      service.approveUser.mockRejectedValue(new UserNotPendingException('u1'));

      await expect(controller.approveUser('u1', { role: 'viewer' })).rejects.toThrow(
        ConflictException
      );
    });
  });

  describe('rejectUser', () => {
    it('should call service.rejectUser with id', async () => {
      service.rejectUser.mockResolvedValue(undefined);

      await controller.rejectUser('u1');

      expect(service.rejectUser).toHaveBeenCalledWith('u1');
    });

    it('should throw ConflictException when user is not pending', async () => {
      service.rejectUser.mockRejectedValue(new UserNotPendingException('u1'));

      await expect(controller.rejectUser('u1')).rejects.toThrow(ConflictException);
    });
  });

  describe('updateRole', () => {
    it('should call service.updateRole with id and role', async () => {
      service.updateRole.mockResolvedValue(undefined);

      await controller.updateRole('u1', { role: 'admin' });

      expect(service.updateRole).toHaveBeenCalledWith('u1', 'admin');
    });
  });

  describe('deactivateUser', () => {
    it('should call service.deactivateUser with id', async () => {
      service.deactivateUser.mockResolvedValue(undefined);

      await controller.deactivateUser('u1');

      expect(service.deactivateUser).toHaveBeenCalledWith('u1');
    });

    it('should throw ConflictException when user is not active', async () => {
      service.deactivateUser.mockRejectedValue(new UserNotActiveException('u1'));

      await expect(controller.deactivateUser('u1')).rejects.toThrow(ConflictException);
    });
  });

  describe('reactivateUser', () => {
    it('should call service.reactivateUser with id', async () => {
      service.reactivateUser.mockResolvedValue(undefined);

      await controller.reactivateUser('u1');

      expect(service.reactivateUser).toHaveBeenCalledWith('u1');
    });

    it('should throw ConflictException when user is not deactivated', async () => {
      service.reactivateUser.mockRejectedValue(new UserNotDeactivatedException('u1'));

      await expect(controller.reactivateUser('u1')).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteUser', () => {
    it('should call service.deleteUser with id', async () => {
      service.deleteUser.mockResolvedValue(undefined);

      await controller.deleteUser('u1');

      expect(service.deleteUser).toHaveBeenCalledWith('u1');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      service.deleteUser.mockRejectedValue(new UserNotFoundException('ghost'));

      await expect(controller.deleteUser('ghost')).rejects.toThrow(NotFoundException);
    });
  });
});
