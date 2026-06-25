/**
 * UserManagementService Unit Tests
 *
 * @module apps/api/src/users
 */
import { UserManagementService } from './user-management.service';
import {
  User,
  UserNotFoundException,
  UserNotPendingException,
  type UserRepositoryPort,
} from '@openlinker/core/users';

const makeUser = (id: string, status: 'pending' | 'active' | 'deactivated' = 'active'): User =>
  new User(id, `user-${id}`, `${id}@test.com`, 'hash', 'viewer', status, new Date(), new Date());

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

  describe('deactivateUser', () => {
    it('should set user status to deactivated', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'active'));

      await service.deactivateUser('u1');

      expect(repo.updateStatus).toHaveBeenCalledWith('u1', 'deactivated');
    });
  });

  describe('reactivateUser', () => {
    it('should set user status to active', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'deactivated'));

      await service.reactivateUser('u1');

      expect(repo.updateStatus).toHaveBeenCalledWith('u1', 'active');
    });
  });

  describe('deleteUser', () => {
    it('should delete a user by id', async () => {
      repo.findById.mockResolvedValue(makeUser('u1', 'active'));

      await service.deleteUser('u1');

      expect(repo.deleteById).toHaveBeenCalledWith('u1');
    });

    it('should throw UserNotFoundException for unknown user', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.deleteUser('ghost')).rejects.toThrow(UserNotFoundException);
    });
  });
});
