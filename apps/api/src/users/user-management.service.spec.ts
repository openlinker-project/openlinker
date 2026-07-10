/**
 * UserManagementService Unit Tests
 *
 * @module apps/api/src/users
 */
import { UserManagementService } from './user-management.service';
import {
  User,
  CannotSelfModifyException,
  LastAdminException,
  UserNotFoundException,
  UserNotActiveException,
  UserNotDeactivatedException,
  UserNotPendingException,
  type UserRepositoryPort,
} from '@openlinker/core/users';

const makeUser = (
  id: string,
  status: 'pending' | 'active' | 'deactivated' = 'active',
  role: 'admin' | 'viewer' = 'viewer'
): User => new User(id, `user-${id}`, `${id}@test.com`, 'hash', role, status, new Date(), new Date());

const makeRepo = (): jest.Mocked<UserRepositoryPort> => ({
  findByUsername: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
  save: jest.fn(),
  updatePasswordHash: jest.fn(),
  updateStatus: jest.fn(),
  updateRole: jest.fn(),
  approveUser: jest.fn(),
  deleteById: jest.fn(),
  deactivateAdminAtomically: jest.fn(),
  updateAdminRoleAtomically: jest.fn(),
  deleteAdminAtomically: jest.fn(),
  findStaleViewerAccounts: jest.fn(),
});

describe('UserManagementService', () => {
  let repo: jest.Mocked<UserRepositoryPort>;
  let service: UserManagementService;

  beforeEach(() => {
    repo = makeRepo();
    service = new UserManagementService(repo);
  });

  describe('listUsers', () => {
    it('should delegate to findAll with passed options', async () => {
      const expected = { users: [makeUser('1')], total: 1 };
      repo.findAll.mockResolvedValue(expected);

      const result = await service.listUsers({ status: 'active', page: 0, pageSize: 10 });

      expect(repo.findAll).toHaveBeenCalledWith({ status: 'active', page: 0, pageSize: 10 });
      expect(result).toEqual(expected);
    });
  });

  describe('approveUser', () => {
    it('should approve a pending user atomically with the given role', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'pending'));

      await service.approveUser('u1', 'admin');

      expect(repo.approveUser).toHaveBeenCalledWith('u1', 'admin');
      expect(repo.updateRole).not.toHaveBeenCalled();
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });

    it('should throw UserNotPendingException for a non-pending user', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'active'));

      await expect(service.approveUser('u1', 'viewer')).rejects.toThrow(UserNotPendingException);
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });

    it('should throw UserNotFoundException for an unknown user', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.approveUser('ghost', 'viewer')).rejects.toThrow(UserNotFoundException);
    });
  });

  describe('rejectUser', () => {
    it('should delete a pending user', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'pending'));

      await service.rejectUser('u1');

      expect(repo.deleteById).toHaveBeenCalledWith('u1');
    });

    it('should throw UserNotPendingException for a non-pending user', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'active'));

      await expect(service.rejectUser('u1')).rejects.toThrow(UserNotPendingException);
      expect(repo.deleteById).not.toHaveBeenCalled();
    });
  });

  describe('updateRole', () => {
    it('should throw CannotSelfModifyException when actor modifies their own role', async () => {
      await expect(service.updateRole('u1', 'viewer', 'u1')).rejects.toThrow(
        CannotSelfModifyException
      );
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('should call updateAdminRoleAtomically when demoting an admin', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'admin'));
      repo.updateAdminRoleAtomically.mockResolvedValue({ updated: true });

      await service.updateRole('u2', 'viewer', 'u1');

      expect(repo.updateAdminRoleAtomically).toHaveBeenCalledWith('u2', 'viewer');
      expect(repo.updateRole).not.toHaveBeenCalled();
    });

    it('should throw LastAdminException when updateAdminRoleAtomically returns updated=false', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'admin'));
      repo.updateAdminRoleAtomically.mockResolvedValue({ updated: false });

      await expect(service.updateRole('u2', 'viewer', 'u1')).rejects.toThrow(LastAdminException);
    });

    it('should use plain updateRole when promoting a non-admin to admin', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'viewer'));
      repo.updateRole.mockResolvedValue(undefined);

      await service.updateRole('u2', 'admin', 'u1');

      expect(repo.updateAdminRoleAtomically).not.toHaveBeenCalled();
      expect(repo.updateRole).toHaveBeenCalledWith('u2', 'admin');
    });

    it('should use plain updateRole when reassigning admin→admin', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'admin'));
      repo.updateRole.mockResolvedValue(undefined);

      await service.updateRole('u2', 'admin', 'u1');

      expect(repo.updateAdminRoleAtomically).not.toHaveBeenCalled();
      expect(repo.updateRole).toHaveBeenCalledWith('u2', 'admin');
    });
  });

  describe('deactivateUser', () => {
    it('should throw CannotSelfModifyException when actor deactivates themselves', async () => {
      await expect(service.deactivateUser('u1', 'u1')).rejects.toThrow(CannotSelfModifyException);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('should call deactivateAdminAtomically when deactivating an admin', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'admin'));
      repo.deactivateAdminAtomically.mockResolvedValue({ updated: true });

      await service.deactivateUser('u2', 'u1');

      expect(repo.deactivateAdminAtomically).toHaveBeenCalledWith('u2');
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });

    it('should throw LastAdminException when deactivateAdminAtomically returns updated=false', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'admin'));
      repo.deactivateAdminAtomically.mockResolvedValue({ updated: false });

      await expect(service.deactivateUser('u2', 'u1')).rejects.toThrow(LastAdminException);
    });

    it('should use plain updateStatus for a non-admin', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'viewer'));
      repo.updateStatus.mockResolvedValue(undefined);

      await service.deactivateUser('u2', 'u1');

      expect(repo.updateStatus).toHaveBeenCalledWith('u2', 'deactivated');
      expect(repo.deactivateAdminAtomically).not.toHaveBeenCalled();
    });

    it('should throw UserNotActiveException when user is pending', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'pending'));

      await expect(service.deactivateUser('u2', 'u1')).rejects.toThrow(UserNotActiveException);
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });

    it('should throw UserNotActiveException when user is already deactivated', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'deactivated'));

      await expect(service.deactivateUser('u2', 'u1')).rejects.toThrow(UserNotActiveException);
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('reactivateUser', () => {
    it('should set user status to active', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'deactivated'));

      await service.reactivateUser('u1');

      expect(repo.updateStatus).toHaveBeenCalledWith('u1', 'active');
    });

    it('should throw UserNotDeactivatedException when user is active', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'active'));

      await expect(service.reactivateUser('u1')).rejects.toThrow(UserNotDeactivatedException);
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });

    it('should throw UserNotDeactivatedException when user is pending', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'pending'));

      await expect(service.reactivateUser('u1')).rejects.toThrow(UserNotDeactivatedException);
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('should throw CannotSelfModifyException when actor deletes themselves', async () => {
      await expect(service.deleteUser('u1', 'u1')).rejects.toThrow(CannotSelfModifyException);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('should call deleteAdminAtomically when deleting an admin', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'admin'));
      repo.deleteAdminAtomically.mockResolvedValue({ deleted: true });

      await service.deleteUser('u2', 'u1');

      expect(repo.deleteAdminAtomically).toHaveBeenCalledWith('u2');
      expect(repo.deleteById).not.toHaveBeenCalled();
    });

    it('should throw LastAdminException when deleteAdminAtomically returns deleted=false', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'admin'));
      repo.deleteAdminAtomically.mockResolvedValue({ deleted: false });

      await expect(service.deleteUser('u2', 'u1')).rejects.toThrow(LastAdminException);
    });

    it('should use plain deleteById for a non-admin', async () => {
      repo.findById.mockResolvedValue(makeUser('u2', 'active', 'viewer'));
      repo.deleteById.mockResolvedValue(undefined);

      await service.deleteUser('u2', 'u1');

      expect(repo.deleteById).toHaveBeenCalledWith('u2');
      expect(repo.deleteAdminAtomically).not.toHaveBeenCalled();
    });

    it('should throw UserNotFoundException for unknown user', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.deleteUser('ghost', 'u1')).rejects.toThrow(UserNotFoundException);
    });
  });
});
