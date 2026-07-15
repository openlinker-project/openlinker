/**
 * EmailConfirmationService Unit Tests
 *
 * @module apps/api/src/auth
 */
import type { ConfigService } from '@nestjs/config';
import {
  EmailConfirmationToken,
  InvalidEmailConfirmationTokenException,
  User,
  UserNotFoundException,
  UserNotPendingConfirmationException,
  type EmailConfirmationTokenRepositoryPort,
  type MailerPort,
  type UserRepositoryPort,
} from '@openlinker/core/users';
import { EmailConfirmationService } from './email-confirmation.service';
import type { IUserManagementService } from '../users/user-management.service.interface';

const makeUser = (
  email: string | null = 'demo@test.com',
  status: User['status'] = 'pending_confirmation',
): User => new User('user-1', 'demo_user', email, 'hash', 'viewer', status, new Date(), new Date());

const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
  ({
    get: jest.fn((key: string, fallback?: string) => overrides[key] ?? fallback),
  }) as unknown as ConfigService;

const makeTokenRepo = (): jest.Mocked<EmailConfirmationTokenRepositoryPort> => ({
  save: jest.fn(),
  consumeToken: jest.fn(),
  invalidateActiveForUser: jest.fn(),
});

const makeMailer = (): jest.Mocked<MailerPort> => ({
  sendEmail: jest.fn(),
});

const makeUserManagementService = (): jest.Mocked<IUserManagementService> => ({
  listUsers: jest.fn(),
  approveUser: jest.fn(),
  rejectUser: jest.fn(),
  updateRole: jest.fn(),
  deactivateUser: jest.fn(),
  reactivateUser: jest.fn(),
  deleteUser: jest.fn(),
  confirmEmail: jest.fn(),
});

const makeUserRepo = (): jest.Mocked<UserRepositoryPort> => ({
  findByUsername: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
  updatePasswordHash: jest.fn(),
  updateStatus: jest.fn(),
  updateRole: jest.fn(),
  approveUser: jest.fn(),
  deleteById: jest.fn(),
  findStaleViewerAccounts: jest.fn(),
  save: jest.fn(),
  deactivateAdminAtomically: jest.fn(),
  updateAdminRoleAtomically: jest.fn(),
  deleteAdminAtomically: jest.fn(),
});

describe('EmailConfirmationService', () => {
  describe('sendConfirmation', () => {
    it('saves a hashed token and emails the confirmation link', async () => {
      const tokenRepo = makeTokenRepo();
      const mailer = makeMailer();
      const userManagementService = makeUserManagementService();
      tokenRepo.save.mockResolvedValue(
        new EmailConfirmationToken('t1', 'user-1', 'hash', new Date(), null, new Date()),
      );
      const service = new EmailConfirmationService(
        tokenRepo,
        mailer,
        userManagementService,
        makeUserRepo(),
        makeConfig({ WEB_URL: 'https://app.example.com' }),
      );

      await service.sendConfirmation(makeUser());

      expect(tokenRepo.save).toHaveBeenCalledTimes(1);
      const saved = tokenRepo.save.mock.calls[0][0];
      expect(saved.userId).toBe('user-1');
      expect(saved.tokenHash).toHaveLength(64); // sha256 hex digest length

      expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
      const message = mailer.sendEmail.mock.calls[0][0];
      expect(message.to).toBe('demo@test.com');
      expect(message.text).toContain('https://app.example.com/confirm-email/');
      expect(message.html).toContain('https://app.example.com/confirm-email/');
      expect(message.html).toContain('Confirm your email address');
    });

    it('does not send when the user has no email', async () => {
      const tokenRepo = makeTokenRepo();
      const mailer = makeMailer();
      const service = new EmailConfirmationService(
        tokenRepo,
        mailer,
        makeUserManagementService(),
        makeUserRepo(),
        makeConfig({}),
      );

      await service.sendConfirmation(makeUser(null));

      expect(tokenRepo.save).not.toHaveBeenCalled();
      expect(mailer.sendEmail).not.toHaveBeenCalled();
    });

    it('does not throw when the mailer transport fails', async () => {
      const tokenRepo = makeTokenRepo();
      tokenRepo.save.mockResolvedValue(
        new EmailConfirmationToken('t1', 'user-1', 'hash', new Date(), null, new Date()),
      );
      const mailer = makeMailer();
      mailer.sendEmail.mockRejectedValue(new Error('SMTP down'));
      const service = new EmailConfirmationService(
        tokenRepo,
        mailer,
        makeUserManagementService(),
        makeUserRepo(),
        makeConfig({}),
      );

      await expect(service.sendConfirmation(makeUser())).resolves.toBeUndefined();
    });

    it('does not throw when persisting the token fails (finding 4)', async () => {
      const tokenRepo = makeTokenRepo();
      tokenRepo.save.mockRejectedValue(new Error('DB connection reset'));
      const mailer = makeMailer();
      const service = new EmailConfirmationService(
        tokenRepo,
        mailer,
        makeUserManagementService(),
        makeUserRepo(),
        makeConfig({}),
      );

      await expect(service.sendConfirmation(makeUser())).resolves.toBeUndefined();
      // A failed save must short-circuit before ever attempting to send.
      expect(mailer.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('confirmEmail', () => {
    it('atomically consumes the token and activates the user for a valid token', async () => {
      const tokenRepo = makeTokenRepo();
      const userManagementService = makeUserManagementService();
      tokenRepo.consumeToken.mockResolvedValue('user-1');
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        userManagementService,
        makeUserRepo(),
        makeConfig({}),
      );

      await service.confirmEmail('raw-token');

      expect(tokenRepo.consumeToken).toHaveBeenCalledWith(expect.any(String), expect.any(Date));
      expect(userManagementService.confirmEmail).toHaveBeenCalledWith('user-1');
    });

    it('throws InvalidEmailConfirmationTokenException when consumeToken finds no match (unknown/expired/used)', async () => {
      const tokenRepo = makeTokenRepo();
      tokenRepo.consumeToken.mockResolvedValue(null);
      const userManagementService = makeUserManagementService();
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        userManagementService,
        makeUserRepo(),
        makeConfig({}),
      );

      await expect(service.confirmEmail('bad-token')).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );
      // No match means the atomic UPDATE never fired — never call through.
      expect(userManagementService.confirmEmail).not.toHaveBeenCalled();
    });

    it('throws InvalidEmailConfirmationTokenException for an empty token', async () => {
      const service = new EmailConfirmationService(
        makeTokenRepo(),
        makeMailer(),
        makeUserManagementService(),
        makeUserRepo(),
        makeConfig({}),
      );

      await expect(service.confirmEmail('')).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );
    });

    it('remaps UserNotPendingConfirmationException to InvalidEmailConfirmationTokenException (finding 1)', async () => {
      const tokenRepo = makeTokenRepo();
      tokenRepo.consumeToken.mockResolvedValue('user-1');
      const userManagementService = makeUserManagementService();
      userManagementService.confirmEmail.mockRejectedValue(
        new UserNotPendingConfirmationException('user-1'),
      );
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        userManagementService,
        makeUserRepo(),
        makeConfig({}),
      );

      await expect(service.confirmEmail('raw-token')).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );
    });

    it('remaps UserNotFoundException to InvalidEmailConfirmationTokenException instead of leaking the internal user id', async () => {
      const tokenRepo = makeTokenRepo();
      tokenRepo.consumeToken.mockResolvedValue('user-1');
      const userManagementService = makeUserManagementService();
      userManagementService.confirmEmail.mockRejectedValue(
        new UserNotFoundException('user-1'),
      );
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        userManagementService,
        makeUserRepo(),
        makeConfig({}),
      );

      await expect(service.confirmEmail('raw-token')).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );
    });

    it('logs the original exception constructor name (not its message) before remapping (#1649)', async () => {
      const tokenRepo = makeTokenRepo();
      tokenRepo.consumeToken.mockResolvedValue('user-1');
      const userManagementService = makeUserManagementService();
      userManagementService.confirmEmail.mockRejectedValue(
        new UserNotPendingConfirmationException('user-1'),
      );
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        userManagementService,
        makeUserRepo(),
        makeConfig({}),
      );
      const warnSpy = jest.spyOn(
        (service as unknown as { logger: { warn: (msg: string) => void } }).logger,
        'warn',
      );

      await expect(service.confirmEmail('raw-token')).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('UserNotPendingConfirmationException'),
      );
      // The raw exception message carries the internal user id — must never
      // be logged.
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('user-1'))).toBe(false);
    });

    it('does not consume the token twice for two concurrent calls with the same raw token (finding 2)', async () => {
      const tokenRepo = makeTokenRepo();
      const userManagementService = makeUserManagementService();
      // First caller wins the atomic UPDATE; second sees no matching row.
      tokenRepo.consumeToken.mockResolvedValueOnce('user-1').mockResolvedValueOnce(null);
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        userManagementService,
        makeUserRepo(),
        makeConfig({}),
      );

      const [first, second] = await Promise.allSettled([
        service.confirmEmail('raw-token'),
        service.confirmEmail('raw-token'),
      ]);

      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('rejected');
      expect(userManagementService.confirmEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('resendConfirmation', () => {
    it('invalidates the existing token and sends a fresh one for a pending_confirmation account', async () => {
      const tokenRepo = makeTokenRepo();
      const mailer = makeMailer();
      const userRepo = makeUserRepo();
      const user = makeUser();
      userRepo.findByEmail.mockResolvedValue(user);
      tokenRepo.save.mockResolvedValue(
        new EmailConfirmationToken('t2', 'user-1', 'hash', new Date(), null, new Date()),
      );
      const service = new EmailConfirmationService(
        tokenRepo,
        mailer,
        makeUserManagementService(),
        userRepo,
        makeConfig({ WEB_URL: 'https://app.example.com' }),
      );

      await service.resendConfirmation('demo@test.com');

      expect(tokenRepo.invalidateActiveForUser).toHaveBeenCalledWith('user-1', expect.any(Date));
      expect(tokenRepo.save).toHaveBeenCalledTimes(1);
      expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('no-ops for an unknown email (enumeration-safe)', async () => {
      const tokenRepo = makeTokenRepo();
      const userRepo = makeUserRepo();
      userRepo.findByEmail.mockResolvedValue(null);
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        makeUserManagementService(),
        userRepo,
        makeConfig({}),
      );

      await expect(service.resendConfirmation('ghost@test.com')).resolves.toBeUndefined();

      expect(tokenRepo.invalidateActiveForUser).not.toHaveBeenCalled();
      expect(tokenRepo.save).not.toHaveBeenCalled();
    });

    it('no-ops for an account that is not pending_confirmation (enumeration-safe)', async () => {
      const tokenRepo = makeTokenRepo();
      const userRepo = makeUserRepo();
      userRepo.findByEmail.mockResolvedValue(makeUser('demo@test.com', 'active'));
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        makeUserManagementService(),
        userRepo,
        makeConfig({}),
      );

      await expect(service.resendConfirmation('demo@test.com')).resolves.toBeUndefined();

      expect(tokenRepo.invalidateActiveForUser).not.toHaveBeenCalled();
      expect(tokenRepo.save).not.toHaveBeenCalled();
    });
  });
});
