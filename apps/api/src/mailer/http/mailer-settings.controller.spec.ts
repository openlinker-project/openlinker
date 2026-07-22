/**
 * Mailer Settings Controller — Unit Tests
 *
 * Mocks `IMailerSettingsService`. Asserts: every handler is gated with
 * `@Roles('admin')` (including the read endpoint — mailer settings surface
 * SMTP topology, which is operator-sensitive), the GET response never
 * carries the password (only `smtpPasswordConfigured`), and each handler
 * delegates to the correct service method with the current actor's id.
 *
 * @module apps/api/src/mailer/http
 */
import 'reflect-metadata';
import type { Response } from 'express';
import type { IMailerSettingsService } from '@openlinker/core/mailer';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { MailerSettingsController } from './mailer-settings.controller';
import type { UpdateMailerSettingsDto } from './dto/update-mailer-settings.dto';
import type { SetMailerCredentialsDto } from './dto/set-mailer-credentials.dto';

describe('MailerSettingsController', () => {
  let settings: jest.Mocked<IMailerSettingsService>;
  let controller: MailerSettingsController;
  let res: jest.Mocked<Pick<Response, 'setHeader'>>;
  const user = { id: 'admin-1' } as AuthenticatedUser;

  beforeEach(() => {
    settings = {
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
      setSmtpPassword: jest.fn(),
      clearSmtpPassword: jest.fn(),
      resolveTransportConfig: jest.fn(),
    };
    res = { setHeader: jest.fn() };
    controller = new MailerSettingsController(settings);
  });

  describe('role gating', () => {
    const methods: Array<keyof MailerSettingsController> = [
      'get',
      'update',
      'setCredentials',
      'clearCredentials',
    ];

    it.each(methods)('%s carries @Roles(admin)', (methodName) => {
      const proto = MailerSettingsController.prototype as unknown as Record<string, object>;
      const roles = Reflect.getMetadata(ROLES_KEY, proto[methodName]) as string[] | undefined;
      expect(roles).toEqual(['admin']);
    });
  });

  describe('get', () => {
    it('returns the non-secret view and never leaks the password', async () => {
      settings.getSettings.mockResolvedValue({
        transport: 'smtp',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpSecure: true,
        fromAddress: 'noreply@x.com',
        smtpPasswordConfigured: true,
        updatedAt: new Date('2026-05-01T00:00:00Z'),
        updatedBy: 'admin-1',
      });

      const dto = await controller.get(res as unknown as Response);

      expect(dto.smtpPasswordConfigured).toBe(true);
      expect(Object.keys(dto)).not.toContain('password');
      expect(Object.keys(dto)).not.toContain('smtpPassword');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('update', () => {
    it('delegates to updateSettings with the resolved input and actor id', async () => {
      const dto: UpdateMailerSettingsDto = {
        transport: 'smtp',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpSecure: false,
        fromAddress: 'noreply@x.com',
      };

      await controller.update(dto, user, res as unknown as Response);

      expect(settings.updateSettings).toHaveBeenCalledWith(
        {
          transport: 'smtp',
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          smtpSecure: false,
          fromAddress: 'noreply@x.com',
        },
        'admin-1'
      );
    });

    it('normalizes omitted optional fields to null', async () => {
      const dto: UpdateMailerSettingsDto = { transport: 'console', smtpSecure: false };

      await controller.update(dto, user, res as unknown as Response);

      expect(settings.updateSettings).toHaveBeenCalledWith(
        {
          transport: 'console',
          smtpHost: null,
          smtpPort: null,
          smtpSecure: false,
          fromAddress: null,
        },
        'admin-1'
      );
    });
  });

  describe('setCredentials', () => {
    it('delegates to setSmtpPassword', async () => {
      const dto: SetMailerCredentialsDto = { password: 'super-secret' };

      await controller.setCredentials(dto, user, res as unknown as Response);

      expect(settings.setSmtpPassword).toHaveBeenCalledWith('super-secret', 'admin-1');
    });
  });

  describe('clearCredentials', () => {
    it('delegates to clearSmtpPassword', async () => {
      await controller.clearCredentials(user, res as unknown as Response);

      expect(settings.clearSmtpPassword).toHaveBeenCalledWith('admin-1');
    });
  });
});
