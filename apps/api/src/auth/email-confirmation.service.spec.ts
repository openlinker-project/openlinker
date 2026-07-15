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
  type EmailConfirmationTokenRepositoryPort,
  type MailerPort,
} from '@openlinker/core/users';
import { EmailConfirmationService } from './email-confirmation.service';
import type { IUserManagementService } from '../users/user-management.service.interface';

const makeUser = (email: string | null = 'demo@test.com'): User =>
  new User('user-1', 'demo_user', email, 'hash', 'viewer', 'pending_confirmation', new Date(), new Date());

const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
  ({
    get: jest.fn((key: string, fallback?: string) => overrides[key] ?? fallback),
  }) as unknown as ConfigService;

const makeTokenRepo = (): jest.Mocked<EmailConfirmationTokenRepositoryPort> => ({
  save: jest.fn(),
  findByTokenHash: jest.fn(),
  markUsed: jest.fn(),
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
    });

    it('does not send when the user has no email', async () => {
      const tokenRepo = makeTokenRepo();
      const mailer = makeMailer();
      const service = new EmailConfirmationService(
        tokenRepo,
        mailer,
        makeUserManagementService(),
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
        makeConfig({}),
      );

      await expect(service.sendConfirmation(makeUser())).resolves.toBeUndefined();
    });
  });

  describe('confirmEmail', () => {
    it('activates the user and marks the token used for a valid token', async () => {
      const tokenRepo = makeTokenRepo();
      const userManagementService = makeUserManagementService();
      const futureExpiry = new Date(Date.now() + 60_000);
      const record = new EmailConfirmationToken(
        'token-id',
        'user-1',
        // sha256('raw-token')
        'hash-does-not-need-to-match-in-this-mock',
        futureExpiry,
        null,
        new Date(),
      );
      tokenRepo.findByTokenHash.mockResolvedValue(record);
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        userManagementService,
        makeConfig({}),
      );

      await service.confirmEmail('raw-token');

      expect(userManagementService.confirmEmail).toHaveBeenCalledWith('user-1');
      expect(tokenRepo.markUsed).toHaveBeenCalledWith('token-id', expect.any(Date));
    });

    it('throws InvalidEmailConfirmationTokenException for an unknown token', async () => {
      const tokenRepo = makeTokenRepo();
      tokenRepo.findByTokenHash.mockResolvedValue(null);
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        makeUserManagementService(),
        makeConfig({}),
      );

      await expect(service.confirmEmail('bad-token')).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );
    });

    it('throws InvalidEmailConfirmationTokenException for an expired token', async () => {
      const tokenRepo = makeTokenRepo();
      const pastExpiry = new Date(Date.now() - 60_000);
      tokenRepo.findByTokenHash.mockResolvedValue(
        new EmailConfirmationToken('token-id', 'user-1', 'hash', pastExpiry, null, new Date()),
      );
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        makeUserManagementService(),
        makeConfig({}),
      );

      await expect(service.confirmEmail('expired-token')).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );
    });

    it('throws InvalidEmailConfirmationTokenException for an already-used token', async () => {
      const tokenRepo = makeTokenRepo();
      const futureExpiry = new Date(Date.now() + 60_000);
      tokenRepo.findByTokenHash.mockResolvedValue(
        new EmailConfirmationToken(
          'token-id',
          'user-1',
          'hash',
          futureExpiry,
          new Date(),
          new Date(),
        ),
      );
      const service = new EmailConfirmationService(
        tokenRepo,
        makeMailer(),
        makeUserManagementService(),
        makeConfig({}),
      );

      await expect(service.confirmEmail('used-token')).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );
    });

    it('throws InvalidEmailConfirmationTokenException for an empty token', async () => {
      const service = new EmailConfirmationService(
        makeTokenRepo(),
        makeMailer(),
        makeUserManagementService(),
        makeConfig({}),
      );

      await expect(service.confirmEmail('')).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );
    });
  });
});
