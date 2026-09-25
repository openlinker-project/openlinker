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
  UserAlreadyExistsException,
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
  confirmEmail: jest.fn(),
  setPackStationLabel: jest.fn(),
  recordBenchActivity: jest.fn(),
  createUser: jest.fn(),
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

  describe('listPackers', () => {
    it('should request only active packers and project id+username only', async () => {
      const packer = new User(
        'p1',
        'packer-one',
        'p1@test.com',
        'hash',
        'packer',
        'active',
        new Date(),
        new Date()
      );
      service.listUsers.mockResolvedValue({ users: [packer], total: 1 });

      const result = await controller.listPackers();

      expect(service.listUsers).toHaveBeenCalledWith({
        status: 'active',
        role: 'packer',
        pageSize: 500,
      });
      // #3424 widened the projection with the two presence fields. Asserted
      // EXACTLY rather than with `toMatchObject`: this spec is the one place
      // that says what a roster read discloses, and a partial match would stop
      // noticing a field appearing on it - which for a read that names people
      // is the thing worth noticing.
      //
      // `online: false` is the honest default for a fixture whose user has
      // never been seen at a bench, and `stationLabel: null` means no printer
      // is bound - neither is a value the controller invented. #3456 added
      // `displayName` - the name an admin typed, null for this fixture.
      expect(result.packers).toEqual([
        {
          id: 'p1',
          username: 'packer-one',
          displayName: null,
          online: false,
          stationLabel: null,
        },
      ]);
    });

    it('should return an empty roster when no packers exist', async () => {
      service.listUsers.mockResolvedValue({ users: [], total: 0 });

      const result = await controller.listPackers();

      expect(result.packers).toEqual([]);
    });
  });

  describe('createUser (#3456)', () => {
    const dto = { displayName: 'Anna Kowalska', username: 'anna', role: 'packer' as const };

    it('should create the user and return the id with the one-time password', async () => {
      service.createUser.mockResolvedValue({ id: 'new-id', temporaryPassword: 'Tmp-pass-123456' });

      const result = await controller.createUser(dto);

      expect(service.createUser).toHaveBeenCalledWith({
        displayName: 'Anna Kowalska',
        username: 'anna',
        email: null,
        role: 'packer',
      });
      expect(result).toEqual({ id: 'new-id', temporaryPassword: 'Tmp-pass-123456' });
    });

    it('should pass an email through when given', async () => {
      service.createUser.mockResolvedValue({ id: 'new-id', temporaryPassword: 'x' });

      await controller.createUser({ ...dto, email: 'anna@example.com' });

      expect(service.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'anna@example.com' })
      );
    });

    it.each(['username', 'email'] as const)(
      'should answer 409 naming the %s that is taken',
      async (field) => {
        service.createUser.mockRejectedValue(new UserAlreadyExistsException('taken', field));

        const error = await controller.createUser(dto).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toEqual(
          expect.objectContaining({ field })
        );
      }
    );

    // The 409 names the FIELD, never the colliding value.
    it('should not echo the submitted value in the conflict', async () => {
      service.createUser.mockRejectedValue(
        new UserAlreadyExistsException('anna@example.com', 'email')
      );

      const error = await controller.createUser(dto).catch((caught: unknown) => caught);

      expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain(
        'anna@example.com'
      );
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
