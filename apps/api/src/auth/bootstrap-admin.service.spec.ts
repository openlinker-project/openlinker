/**
 * BootstrapAdminService Unit Tests
 *
 * @module apps/api/src/auth
 */
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Logger } from '@openlinker/shared/logging';
import { User, UserRepositoryPort } from '@openlinker/core/users';
import { BootstrapAdminService } from './bootstrap-admin.service';

const makeUser = (username: string): User =>
  new User('id', username, null, 'hash', 'admin', new Date(), new Date());

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
  findById: jest.fn(),
  save: jest.fn(),
});

describe('BootstrapAdminService', () => {
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('seeds an admin and logs a generated password when none is provided', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));

    const service = new BootstrapAdminService(makeConfig(), repo);
    await service.bootstrap();

    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.username).toBe('admin');
    expect(saved.email).toBe('admin@openlinker.local');
    expect(saved.role).toBe('admin');
    const hash: string = saved.passwordHash;
    expect(await bcrypt.compare('wrong', hash)).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const banner = String(warnSpy.mock.calls[0][0]);
    expect(banner).toMatch(/username=admin/);
    expect(banner).toMatch(/password=/);
  });

  it('seeds with provided password and does NOT log it', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.save.mockImplementation((u) => Promise.resolve(makeUser(u.username)));

    const service = new BootstrapAdminService(
      makeConfig({ OL_BOOTSTRAP_ADMIN_PASSWORD: 'secret-pass' }),
      repo,
    );
    await service.bootstrap();

    const saved = repo.save.mock.calls[0][0];
    const hash: string = saved.passwordHash;
    expect(await bcrypt.compare('secret-pass', hash)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Seeded default admin user 'admin' with provided password"),
    );
  });

  it('skips when admin user already exists', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(makeUser('admin'));

    const service = new BootstrapAdminService(makeConfig(), repo);
    await service.bootstrap();

    expect(repo.save).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('skips when disabled via env', async () => {
    const repo = makeRepo();
    const service = new BootstrapAdminService(
      makeConfig({ OL_BOOTSTRAP_ADMIN_ENABLED: 'false' }),
      repo,
    );
    await service.bootstrap();

    expect(repo.findByUsername).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('treats unique-violation on save as a benign concurrent-boot race', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    const err = Object.assign(new Error('duplicate key'), { code: '23505' });
    repo.save.mockRejectedValue(err);

    const service = new BootstrapAdminService(makeConfig(), repo);
    await expect(service.bootstrap()).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already created by another'));
  });

  it('rethrows non-unique-violation save errors', async () => {
    const repo = makeRepo();
    repo.findByUsername.mockResolvedValue(null);
    repo.save.mockRejectedValue(new Error('connection refused'));

    const service = new BootstrapAdminService(makeConfig(), repo);
    await expect(service.bootstrap()).rejects.toThrow('connection refused');
  });
});
