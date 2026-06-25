/**
 * UsersController Unit Tests
 *
 * @module apps/api/src/users/http
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import {
  USER_MANAGEMENT_SERVICE_TOKEN,
  type IUserManagementService,
} from '../user-management.service.interface';
import {
  User,
  CannotSelfModifyException,
  LastAdminException,
  UserNotFoundException,
  UserNotActiveException,
  UserNotDeactivatedException,
  UserNotPendingException,
} from '@openlinker/core/users';
import type { AuthenticatedUser } from '../../auth/auth.types';

const makeUser = (id: string, status: 'pending' | 'active' | 'deactivated' = 'active'): User =>
  new User(id, `user-${id}`, `${id}@test.com`, 'hash', 'viewer', status, new Date(), new Date());

const makeActor = (id = 'actor-1'): AuthenticatedUser => ({
  id,
  username: 'admin',
  role: 'admin',
});

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
    it('should pass actorId from the authenticated user', async () => {
      service.updateRole.mockResolvedValue(undefined);
      const actor = makeActor('actor-1');

      await controller.updateRole('u2', { role: 'admin' }, actor);

      expect(service.updateRole).toHaveBeenCalledWith('u2', 'admin', 'actor-1');
    });

    it('should throw ForbiddenException on CannotSelfModifyException', async () => {
      service.updateRole.mockRejectedValue(new CannotSelfModifyException());

      await expect(controller.updateRole('actor-1', { role: 'viewer' }, makeActor('actor-1'))).rejects.toThrow(
        ForbiddenException
      );
    });

    it('should throw ForbiddenException on LastAdminException', async () => {
      service.updateRole.mockRejectedValue(new LastAdminException());

      await expect(controller.updateRole('u2', { role: 'viewer' }, makeActor())).rejects.toThrow(
        ForbiddenException
      );
    });
  });

  describe('deactivateUser', () => {
    it('should pass actorId from the authenticated user', async () => {
      service.deactivateUser.mockResolvedValue(undefined);
      const actor = makeActor('actor-1');

      await controller.deactivateUser('u2', actor);

      expect(service.deactivateUser).toHaveBeenCalledWith('u2', 'actor-1');
    });

    it('should throw ForbiddenException on CannotSelfModifyException', async () => {
      service.deactivateUser.mockRejectedValue(new CannotSelfModifyException());

      await expect(controller.deactivateUser('actor-1', makeActor('actor-1'))).rejects.toThrow(
        ForbiddenException
      );
    });

    it('should throw ForbiddenException on LastAdminException', async () => {
      service.deactivateUser.mockRejectedValue(new LastAdminException());

      await expect(controller.deactivateUser('u2', makeActor())).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when user is not active', async () => {
      service.deactivateUser.mockRejectedValue(new UserNotActiveException('u1'));

      await expect(controller.deactivateUser('u1', makeActor())).rejects.toThrow(ConflictException);
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
    it('should pass actorId from the authenticated user', async () => {
      service.deleteUser.mockResolvedValue(undefined);
      const actor = makeActor('actor-1');

      await controller.deleteUser('u2', actor);

      expect(service.deleteUser).toHaveBeenCalledWith('u2', 'actor-1');
    });

    it('should throw ForbiddenException on CannotSelfModifyException', async () => {
      service.deleteUser.mockRejectedValue(new CannotSelfModifyException());

      await expect(controller.deleteUser('actor-1', makeActor('actor-1'))).rejects.toThrow(
        ForbiddenException
      );
    });

    it('should throw ForbiddenException on LastAdminException', async () => {
      service.deleteUser.mockRejectedValue(new LastAdminException());

      await expect(controller.deleteUser('u2', makeActor())).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      service.deleteUser.mockRejectedValue(new UserNotFoundException('ghost'));

      await expect(controller.deleteUser('ghost', makeActor())).rejects.toThrow(NotFoundException);
    });
  });
});
