/**
 * RegistrationService Unit Tests
 *
 * @module apps/api/src/auth
 */
import type { ConfigService } from '@nestjs/config';
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';
import { RegistrationService } from './registration.service';
import type { IDemoModeService } from './demo-mode.service.interface';
import type { IEmailConfirmationService } from './email-confirmation.service.interface';
import {
  RegistrationDisabledException,
  RegistrationRateLimitedException,
  UserAlreadyExistsException,
  User,
  type UserRepositoryPort,
  type UserStatus,
} from '@openlinker/core/users';

const makeUser = (username: string, status: UserStatus = 'pending'): User =>
  new User('id', username, `${username}@test.com`, 'hash', 'viewer', status, new Date(), new Date());

const makeEmailConfirmationService = (): jest.Mocked<IEmailConfirmationService> => ({
  sendConfirmation: jest.fn(),
  confirmEmail: jest.fn(),
  resendConfirmation: jest.fn(),
});

const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
  ({
    get: jest.fn((key: string, defaultValue?: string) => overrides[key] ?? defaultValue),
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
  findStaleViewerAccounts: jest.fn(),
});

describe('RegistrationService', () => {
  it('should throw RegistrationDisabledException when registration is disabled', async () => {
    const repo = makeRepo();
    const service = new RegistrationService(repo, makeConfig({ OL_REGISTRATION_ENABLED: 'false' }), makeDemoService(false), new InMemoryCacheAdapter(), makeEmailConfirmationService());

    await expect(service.register('alice', 'alice@test.com', 'pass123')).rejects.toThrow(
      RegistrationDisabledException
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('should throw UserAlreadyExistsException when username is taken', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(makeUser('alice'));
    repo.findByEmail.mockResolvedValue(null);
    const service = new RegistrationService(repo, makeConfig({ OL_REGISTRATION_ENABLED: 'true' }), makeDemoService(false), new InMemoryCacheAdapter(), makeEmailConfirmationService());

    await expect(service.register('alice', 'newemail@test.com', 'pass123')).rejects.toThrow(
      UserAlreadyExistsException
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('should throw UserAlreadyExistsException when email is taken', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(makeUser('bob'));
    const service = new RegistrationService(repo, makeConfig({ OL_REGISTRATION_ENABLED: 'true' }), makeDemoService(false), new InMemoryCacheAdapter(), makeEmailConfirmationService());

    await expect(service.register('alice', 'bob@test.com', 'pass123')).rejects.toThrow(
      UserAlreadyExistsException
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('should throw UserAlreadyExistsException for a case-variant duplicate email (#1625)', async () => {
    // Mirrors what the real UserRepository.findByEmail does — it normalizes
    // the lookup internally, so a caller passing a mixed-case email still
    // resolves the existing lowercase-stored user.
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(makeUser('foo'));
    const service = new RegistrationService(repo, makeConfig({ OL_REGISTRATION_ENABLED: 'true' }), makeDemoService(false), new InMemoryCacheAdapter(), makeEmailConfirmationService());

    await expect(service.register('user2', 'FOO@EXAMPLE.COM', 'pass123')).rejects.toThrow(
      UserAlreadyExistsException
    );
    expect(repo.findByEmail).toHaveBeenCalledWith('FOO@EXAMPLE.COM');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('should save user in pending status with viewer role when demo mode is off', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));
    const service = new RegistrationService(repo, makeConfig({ OL_REGISTRATION_ENABLED: 'true' }), makeDemoService(false), new InMemoryCacheAdapter(), makeEmailConfirmationService());

    await service.register('alice', 'alice@test.com', 'pass123');

    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.username).toBe('alice');
    expect(saved.email).toBe('alice@test.com');
    expect(saved.role).toBe('viewer');
    expect(saved.status).toBe('pending');
    expect(saved.passwordHash).not.toBe('pass123');
  });

  it('should save user in pending_confirmation status and send a confirmation email when demo mode is on (#1624)', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    const savedUser = makeUser('demo_user', 'pending_confirmation');
    repo.save.mockResolvedValue(savedUser);
    const emailConfirmationService = makeEmailConfirmationService();
    const service = new RegistrationService(
      repo,
      makeConfig({ OL_REGISTRATION_ENABLED: 'true' }),
      makeDemoService(true),
      new InMemoryCacheAdapter(),
      emailConfirmationService,
    );

    await service.register('demo_user', 'demo@test.com', 'pass123');

    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.status).toBe('pending_confirmation');
    expect(saved.role).toBe('viewer');
    expect(emailConfirmationService.sendConfirmation).toHaveBeenCalledWith(savedUser);
  });

  it('should not send a confirmation email when demo mode is off', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.findByEmail.mockResolvedValue(null);
    repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));
    const emailConfirmationService = makeEmailConfirmationService();
    const service = new RegistrationService(
      repo,
      makeConfig({ OL_REGISTRATION_ENABLED: 'true' }),
      makeDemoService(false),
      new InMemoryCacheAdapter(),
      emailConfirmationService,
    );

    await service.register('alice', 'alice@test.com', 'pass123');

    expect(emailConfirmationService.sendConfirmation).not.toHaveBeenCalled();
  });

  describe('analytics consent (#1743)', () => {
    const makeActiveService = (): {
      repo: jest.Mocked<UserRepositoryPort>;
      service: RegistrationService;
    } => {
      const repo = makeRepo();
      repo.findByUsername.mockResolvedValue(null);
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));
      const service = new RegistrationService(
        repo,
        makeConfig({ OL_REGISTRATION_ENABLED: 'true' }),
        makeDemoService(true),
        new InMemoryCacheAdapter(),
        makeEmailConfirmationService(),
      );
      return { repo, service };
    };

    it('should default analyticsConsent to false when the flag is omitted (opt-in)', async () => {
      const { repo, service } = makeActiveService();

      await service.register('alice', 'alice@test.com', 'pass123');

      expect(repo.save.mock.calls[0][0].analyticsConsent).toBe(false);
    });

    it('should persist analyticsConsent=false when the user opts out', async () => {
      const { repo, service } = makeActiveService();

      await service.register('alice', 'alice@test.com', 'pass123', '1.2.3.4', false);

      expect(repo.save.mock.calls[0][0].analyticsConsent).toBe(false);
    });

    it('should persist analyticsConsent=true when explicitly granted', async () => {
      const { repo, service } = makeActiveService();

      await service.register('alice', 'alice@test.com', 'pass123', '1.2.3.4', true);

      expect(repo.save.mock.calls[0][0].analyticsConsent).toBe(true);
    });
  });

  describe('rate limiting (#1469)', () => {
    it('should throw RegistrationRateLimitedException after the configured limit is reached', async () => {
      const repo = makeRepo();
      repo.findByUsername.mockResolvedValue(null);
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));
      const cache = new InMemoryCacheAdapter();
      const service = new RegistrationService(
        repo,
        makeConfig({ OL_REGISTRATION_ENABLED: 'true', OL_DEMO_REGISTRATION_RATE_LIMIT: '2' }),
        makeDemoService(true),
        cache,
        makeEmailConfirmationService(),
      );

      await service.register('user1', 'user1@test.com', 'pass123', '1.2.3.4');
      await service.register('user2', 'user2@test.com', 'pass123', '1.2.3.4');

      await expect(
        service.register('user3', 'user3@test.com', 'pass123', '1.2.3.4'),
      ).rejects.toThrow(RegistrationRateLimitedException);
      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it('should track separate IPs independently', async () => {
      const repo = makeRepo();
      repo.findByUsername.mockResolvedValue(null);
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));
      const cache = new InMemoryCacheAdapter();
      const service = new RegistrationService(
        repo,
        makeConfig({ OL_REGISTRATION_ENABLED: 'true', OL_DEMO_REGISTRATION_RATE_LIMIT: '1' }),
        makeDemoService(true),
        cache,
        makeEmailConfirmationService(),
      );

      await service.register('user1', 'user1@test.com', 'pass123', '1.1.1.1');
      await service.register('user2', 'user2@test.com', 'pass123', '2.2.2.2');

      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it('should not rate-limit when demo mode is off, even with a clientIp', async () => {
      const repo = makeRepo();
      repo.findByUsername.mockResolvedValue(null);
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));
      const cache = new InMemoryCacheAdapter();
      const service = new RegistrationService(
        repo,
        makeConfig({ OL_REGISTRATION_ENABLED: 'true', OL_DEMO_REGISTRATION_RATE_LIMIT: '1' }),
        makeDemoService(false),
        cache,
        makeEmailConfirmationService(),
      );

      await service.register('user1', 'user1@test.com', 'pass123', '1.2.3.4');
      await service.register('user2', 'user2@test.com', 'pass123', '1.2.3.4');

      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it('should not rate-limit when no clientIp is provided', async () => {
      const repo = makeRepo();
      repo.findByUsername.mockResolvedValue(null);
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));
      const cache = new InMemoryCacheAdapter();
      const service = new RegistrationService(
        repo,
        makeConfig({ OL_REGISTRATION_ENABLED: 'true', OL_DEMO_REGISTRATION_RATE_LIMIT: '1' }),
        makeDemoService(true),
        cache,
        makeEmailConfirmationService(),
      );

      await service.register('user1', 'user1@test.com', 'pass123');
      await service.register('user2', 'user2@test.com', 'pass123');

      expect(repo.save).toHaveBeenCalledTimes(2);
    });
  });
});
