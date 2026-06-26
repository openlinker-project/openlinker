/**
 * BootstrapAdminService Unit Tests
 *
 * @module apps/api/src/auth
 */
import type { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Logger } from '@openlinker/shared/logging';
import type { UserRepositoryPort } from '@openlinker/core/users';
import { User, UserAlreadyExistsException } from '@openlinker/core/users';
import { BootstrapAdminService } from './bootstrap-admin.service';

const makeUser = (username: string): User =>
  new User('id', username, null, 'hash', 'admin', 'active', new Date(), new Date());

const makeConfig = (overrides: Record<string, string | undefined> = {}): ConfigService => {
  const values: Record<string, string | undefined> = {
    OL_BOOTSTRAP_ADMIN_ENABLED: 'true',
    OL_BOOTSTRAP_ADMIN_USERNAME: 'admin',
    OL_BOOTSTRAP_ADMIN_EMAIL: 'admin@openlinker.local',
    ...overrides,
  };
  return {
    get: jest.fn((key: string, defaultValue?: string) => values[key] ?? defaultValue),
  } as unknown as ConfigService;
};

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
  countByRole: jest.fn(),
  deleteById: jest.fn(),
  deactivateIfNotLastAdmin: jest.fn(),
  updateRoleIfNotLastAdmin: jest.fn(),
  deleteIfNotLastAdmin: jest.fn(),
});

describe('BootstrapAdminService', () => {
  let warnMessages: string[];
  let logMessages: string[];

  beforeEach(() => {
    warnMessages = [];
    logMessages = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((msg: unknown) => {
      warnMessages.push(String(msg));
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation((msg: unknown) => {
      logMessages.push(String(msg));
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('seeds admin/admin in non-production when no password is provided', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));

    const service = new BootstrapAdminService(makeConfig({ NODE_ENV: 'development' }), repo);
    await service.bootstrap();

    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.username).toBe('admin');
    expect(saved.email).toBe('admin@openlinker.local');
    expect(saved.role).toBe('admin');
    const hash: string = saved.passwordHash;
    expect(await bcrypt.compare('admin', hash)).toBe(true);
    expect(await bcrypt.compare('wrong', hash)).toBe(false);
    expect(warnMessages).toHaveLength(1);
    expect(warnMessages[0]).toMatch(/literal password `admin`/);
    expect(warnMessages[0]).toMatch(/password=admin/);
    expect(warnMessages[0]).toMatch(/before promoting this instance/);
  });

  it('seeds a random password in production when none is provided', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));

    const service = new BootstrapAdminService(makeConfig({ NODE_ENV: 'production' }), repo);
    await service.bootstrap();

    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    const hash: string = saved.passwordHash;
    // Random password: must NOT match the dev literal
    expect(await bcrypt.compare('admin', hash)).toBe(false);
    expect(warnMessages).toHaveLength(1);
    expect(warnMessages[0]).toMatch(/store these credentials now/);
    expect(warnMessages[0]).toMatch(/username=admin/);
    expect(warnMessages[0]).toMatch(/password=/);
    // Banner must NOT contain the default-admin wording
    expect(warnMessages[0]).not.toMatch(/literal password `admin`/);
  });

  it('seeds with provided password and does NOT log it', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));

    const service = new BootstrapAdminService(
      makeConfig({ OL_BOOTSTRAP_ADMIN_PASSWORD: 'secret-pass' }),
      repo
    );
    await service.bootstrap();

    const saved = repo.save.mock.calls[0][0];
    const hash: string = saved.passwordHash;
    expect(await bcrypt.compare('secret-pass', hash)).toBe(true);
    expect(warnMessages).toHaveLength(0);
    expect(logMessages).toContainEqual(
      expect.stringContaining("Seeded default admin user 'admin' with provided password")
    );
  });

  it('skips when admin user already exists', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(makeUser('admin'));

    const service = new BootstrapAdminService(makeConfig(), repo);
    await service.bootstrap();

    expect(repo.save).not.toHaveBeenCalled();
    expect(warnMessages).toHaveLength(0);
  });

  it('skips when disabled via env', async () => {
    const repo = makeRepo();
    const service = new BootstrapAdminService(
      makeConfig({ OL_BOOTSTRAP_ADMIN_ENABLED: 'false' }),
      repo
    );
    await service.bootstrap();

    expect(repo.findByUsername).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('treats unique-violation on save as a benign concurrent-boot race', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.save.mockRejectedValue(new UserAlreadyExistsException('admin'));

    const service = new BootstrapAdminService(makeConfig(), repo);
    await expect(service.bootstrap()).resolves.toBeUndefined();
    expect(logMessages).toContainEqual(expect.stringContaining('already created by another'));
  });

  it('rethrows non-unique-violation save errors', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.save.mockRejectedValue(new Error('connection refused'));

    const service = new BootstrapAdminService(makeConfig(), repo);
    await expect(service.bootstrap()).rejects.toThrow('connection refused');
  });
});
