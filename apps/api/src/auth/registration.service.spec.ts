/**
 * RegistrationService Unit Tests
 *
 * @module apps/api/src/auth
 */
import type { ConfigService } from '@nestjs/config';
import { RegistrationService } from './registration.service';
import type { IDemoModeService } from './demo-mode.service.interface';
import {
  RegistrationDisabledException,
  UserAlreadyExistsException,
  User,
  type UserRepositoryPort,
} from '@openlinker/core/users';

const makeUser = (username: string): User =>
  new User('id', username, `${username}@test.com`, 'hash', 'viewer', 'pending', new Date(), new Date());

const makeConfig = (enabled: string): ConfigService =>
  ({
    get: jest.fn((key: string, defaultValue?: string) =>
      key === 'OL_REGISTRATION_ENABLED' ? enabled : defaultValue
    ),
  }) as unknown as ConfigService;

const makeDemoService = (enabled: boolean): IDemoModeService => ({
  isDemoModeEnabled: () => enabled,
});

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
});

describe('RegistrationService', () => {
  it('should throw RegistrationDisabledException when registration is disabled', async () => {
    const repo = makeRepo();
    const service = new RegistrationService(repo, makeConfig('false'), makeDemoService(false));

    await expect(service.register('alice', 'alice@test.com', 'pass123')).rejects.toThrow(
      RegistrationDisabledException
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('should throw UserAlreadyExistsException when username is taken', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(makeUser('alice'));
    repo.findByEmail.mockResolvedValue(null);
    const service = new RegistrationService(repo, makeConfig('true'), makeDemoService(false));

    await expect(service.register('alice', 'newemail@test.com', 'pass123')).rejects.toThrow(
      UserAlreadyExistsException
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('should throw UserAlreadyExistsException when email is taken', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(makeUser('bob'));
    const service = new RegistrationService(repo, makeConfig('true'), makeDemoService(false));

    await expect(service.register('alice', 'bob@test.com', 'pass123')).rejects.toThrow(
      UserAlreadyExistsException
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('should save user in pending status with viewer role when demo mode is off', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));
    const service = new RegistrationService(repo, makeConfig('true'), makeDemoService(false));

    await service.register('alice', 'alice@test.com', 'pass123');

    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.username).toBe('alice');
    expect(saved.email).toBe('alice@test.com');
    expect(saved.role).toBe('viewer');
    expect(saved.status).toBe('pending');
    expect(saved.passwordHash).not.toBe('pass123');
  });

  it('should save user in active status when demo mode is on', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));
    const service = new RegistrationService(repo, makeConfig('true'), makeDemoService(true));

    await service.register('demo_user', 'demo@test.com', 'pass123');

    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.status).toBe('active');
    expect(saved.role).toBe('viewer');
  });
});
