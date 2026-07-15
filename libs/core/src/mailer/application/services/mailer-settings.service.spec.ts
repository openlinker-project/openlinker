/**
 * Mailer Settings Service — Unit Tests
 *
 * Mocks the settings repo + `ICredentialsService` + `ConfigService`.
 * Asserts: GET view never carries the password; DB row wins over env when
 * present; env-only fallback reproduces the pre-#1643 `createMailer`
 * resolution when no row exists; console default when neither DB nor env
 * are set; credential write/clear delegate correctly, including the
 * create-on-missing-ref fallback.
 *
 * @module libs/core/src/mailer/application/services
 */
import type { ConfigService } from '@nestjs/config';
import { Logger as SharedLogger } from '@openlinker/shared/logging';
import {
  CredentialNotFoundException,
  IntegrationCredential,
  type ICredentialsService,
} from '@openlinker/core/integrations';
import { MailerSettings } from '../../domain/entities/mailer-settings.entity';
import type { MailerSettingsRepositoryPort } from '../../domain/ports/mailer-settings-repository.port';
import { MAILER_SMTP_CREDENTIALS_REF } from '../../domain/types/mailer-credentials.types';
import { MailerSettingsService } from './mailer-settings.service';

const buildConfigService = (overrides: Record<string, string | undefined> = {}): ConfigService =>
  ({
    get: <T = string>(key: string, fallback?: T): T | undefined =>
      (overrides[key] as T | undefined) ?? fallback,
  }) as unknown as ConfigService;

const buildCredential = (password: string): IntegrationCredential =>
  new IntegrationCredential(
    'cred-1',
    MAILER_SMTP_CREDENTIALS_REF,
    'mailer',
    { password },
    new Date(),
    new Date()
  );

describe('MailerSettingsService', () => {
  let repository: jest.Mocked<MailerSettingsRepositoryPort>;
  let credentials: jest.Mocked<ICredentialsService>;
  let logSpy: jest.SpyInstance;

  const buildService = (config: ConfigService = buildConfigService()): MailerSettingsService =>
    new MailerSettingsService(repository, credentials, config);

  beforeEach(() => {
    repository = {
      findSettings: jest.fn(),
      upsertSettings: jest.fn(),
    };
    credentials = {
      getByRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    logSpy = jest.spyOn(SharedLogger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('getSettings', () => {
    it('returns console defaults with no timestamps when no row exists', async () => {
      repository.findSettings.mockResolvedValue(null);
      credentials.getByRef.mockRejectedValue(
        new CredentialNotFoundException(MAILER_SMTP_CREDENTIALS_REF)
      );

      const view = await buildService().getSettings();

      expect(view).toEqual({
        transport: 'console',
        smtpHost: null,
        smtpPort: null,
        smtpSecure: false,
        fromAddress: null,
        smtpPasswordConfigured: false,
        updatedAt: null,
        updatedBy: null,
      });
    });

    it('never includes the password, only whether one is configured', async () => {
      const updatedAt = new Date('2026-05-01T00:00:00Z');
      repository.findSettings.mockResolvedValue(
        new MailerSettings(
          'smtp',
          'smtp.example.com',
          587,
          true,
          'noreply@x.com',
          updatedAt,
          'admin'
        )
      );
      credentials.getByRef.mockResolvedValue(buildCredential('super-secret'));

      const view = await buildService().getSettings();

      expect(view).toEqual({
        transport: 'smtp',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpSecure: true,
        fromAddress: 'noreply@x.com',
        smtpPasswordConfigured: true,
        updatedAt,
        updatedBy: 'admin',
      });
      expect(JSON.stringify(view)).not.toContain('super-secret');
    });

    it('reports smtpPasswordConfigured=true from env when no DB credential exists', async () => {
      repository.findSettings.mockResolvedValue(null);
      credentials.getByRef.mockRejectedValue(
        new CredentialNotFoundException(MAILER_SMTP_CREDENTIALS_REF)
      );
      const service = buildService(buildConfigService({ MAIL_SMTP_PASSWORD: 'env-secret' }));

      const view = await service.getSettings();

      expect(view.smtpPasswordConfigured).toBe(true);
    });
  });

  describe('updateSettings', () => {
    it('delegates to the repository and logs the transport', async () => {
      repository.upsertSettings.mockResolvedValue(
        new MailerSettings('smtp', 'smtp.x', 587, false, 'a@b.com', new Date(), 'admin')
      );

      await buildService().updateSettings(
        {
          transport: 'smtp',
          smtpHost: 'smtp.x',
          smtpPort: 587,
          smtpSecure: false,
          fromAddress: 'a@b.com',
        },
        'admin'
      );

      expect(repository.upsertSettings).toHaveBeenCalledWith(
        {
          transport: 'smtp',
          smtpHost: 'smtp.x',
          smtpPort: 587,
          smtpSecure: false,
          fromAddress: 'a@b.com',
        },
        'admin'
      );
    });
  });

  describe('setSmtpPassword / clearSmtpPassword', () => {
    it('updates the existing credential when present', async () => {
      credentials.update.mockResolvedValue(buildCredential('new-pass'));

      await buildService().setSmtpPassword('new-pass', 'admin');

      expect(credentials.update).toHaveBeenCalledWith(MAILER_SMTP_CREDENTIALS_REF, {
        credentialsJson: { password: 'new-pass' },
      });
      expect(credentials.create).not.toHaveBeenCalled();
    });

    it('creates the credential when the ref does not exist yet', async () => {
      credentials.update.mockRejectedValue(
        new CredentialNotFoundException(MAILER_SMTP_CREDENTIALS_REF)
      );
      credentials.create.mockResolvedValue(buildCredential('new-pass'));

      await buildService().setSmtpPassword('new-pass', 'admin');

      expect(credentials.create).toHaveBeenCalledWith({
        ref: MAILER_SMTP_CREDENTIALS_REF,
        platformType: 'mailer',
        credentialsJson: { password: 'new-pass' },
      });
    });

    it('clears the credential', async () => {
      credentials.delete.mockResolvedValue(true);

      await buildService().clearSmtpPassword('admin');

      expect(credentials.delete).toHaveBeenCalledWith(MAILER_SMTP_CREDENTIALS_REF);
    });
  });

  describe('resolveTransportConfig', () => {
    it('resolves console default when no DB row and no env are set', async () => {
      repository.findSettings.mockResolvedValue(null);

      const config = await buildService().resolveTransportConfig();

      expect(config).toEqual({
        transport: 'console',
        smtpHost: null,
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: null,
        smtpPassword: null,
        fromAddress: 'no-reply@openlinker.local',
      });
    });

    it('falls back to env vars when no DB row exists (pre-#1643 behavior)', async () => {
      repository.findSettings.mockResolvedValue(null);
      const service = buildService(
        buildConfigService({
          MAIL_SMTP_HOST: 'smtp.env.com',
          MAIL_SMTP_PORT: '2525',
          MAIL_SMTP_SECURE: 'true',
          MAIL_SMTP_USER: 'env-user',
          MAIL_SMTP_PASSWORD: 'env-pass',
          MAIL_FROM: 'env@x.com',
        })
      );

      const config = await service.resolveTransportConfig();

      expect(config).toEqual({
        transport: 'smtp',
        smtpHost: 'smtp.env.com',
        smtpPort: 2525,
        smtpSecure: true,
        smtpUser: 'env-user',
        smtpPassword: 'env-pass',
        fromAddress: 'env@x.com',
      });
    });

    it('DB row wins over env vars when a row exists', async () => {
      repository.findSettings.mockResolvedValue(
        new MailerSettings('smtp', 'smtp.db.com', 465, true, 'db@x.com', new Date(), 'admin')
      );
      credentials.getByRef.mockResolvedValue(buildCredential('db-pass'));
      const service = buildService(
        buildConfigService({ MAIL_SMTP_HOST: 'smtp.env.com', MAIL_SMTP_PASSWORD: 'env-pass' })
      );

      const config = await service.resolveTransportConfig();

      expect(config).toEqual({
        transport: 'smtp',
        smtpHost: 'smtp.db.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: null,
        smtpPassword: 'db-pass',
        fromAddress: 'db@x.com',
      });
    });

    it('returns console transport when the DB row transport is console, ignoring smtp env vars', async () => {
      repository.findSettings.mockResolvedValue(
        new MailerSettings('console', null, null, false, null, new Date(), 'admin')
      );
      const service = buildService(buildConfigService({ MAIL_SMTP_HOST: 'smtp.env.com' }));

      const config = await service.resolveTransportConfig();

      expect(config.transport).toBe('console');
      expect(config.smtpHost).toBeNull();
    });

    it('falls back to the env password when the DB row is smtp but no credential row exists', async () => {
      repository.findSettings.mockResolvedValue(
        new MailerSettings('smtp', 'smtp.db.com', 465, true, 'db@x.com', new Date(), 'admin')
      );
      credentials.getByRef.mockRejectedValue(
        new CredentialNotFoundException(MAILER_SMTP_CREDENTIALS_REF)
      );
      const service = buildService(buildConfigService({ MAIL_SMTP_PASSWORD: 'env-pass' }));

      const config = await service.resolveTransportConfig();

      expect(config.smtpPassword).toBe('env-pass');
    });
  });
});
