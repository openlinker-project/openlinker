/**
 * PostHog Settings Controller — Unit Tests
 *
 * Mocks `IPosthogSettingsService`. Asserts: every handler is gated with
 * `@Roles('admin')` (settings surface whether analytics is on and how it's
 * configured — operator-sensitive), the GET response never carries the API
 * key (only `apiKeyConfigured`), and each handler delegates to the correct
 * service method with the current actor's id.
 *
 * @module apps/api/src/analytics/http
 */
import 'reflect-metadata';
import type { Response } from 'express';
import type { IPosthogSettingsService } from '@openlinker/core/analytics';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { PosthogSettingsController } from './posthog-settings.controller';
import type { UpdatePosthogSettingsDto } from './dto/update-posthog-settings.dto';
import type { SetPosthogCredentialsDto } from './dto/set-posthog-credentials.dto';

describe('PosthogSettingsController', () => {
  let settings: jest.Mocked<IPosthogSettingsService>;
  let controller: PosthogSettingsController;
  let res: jest.Mocked<Pick<Response, 'setHeader'>>;
  const user = { id: 'admin-1' } as AuthenticatedUser;

  beforeEach(() => {
    settings = {
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
      setApiKey: jest.fn(),
      clearApiKey: jest.fn(),
      resolveConfig: jest.fn(),
    };
    res = { setHeader: jest.fn() };
    controller = new PosthogSettingsController(settings);
  });

  describe('role gating', () => {
    const methods: Array<keyof PosthogSettingsController> = [
      'get',
      'update',
      'setCredentials',
      'clearCredentials',
    ];

    it.each(methods)('%s carries @Roles(admin)', (methodName) => {
      const proto = PosthogSettingsController.prototype as unknown as Record<string, object>;
      const roles = Reflect.getMetadata(ROLES_KEY, proto[methodName]) as string[] | undefined;
      expect(roles).toEqual(['admin']);
    });
  });

  describe('get', () => {
    it('returns the non-secret view and never leaks the API key', async () => {
      settings.getSettings.mockResolvedValue({
        enabled: true,
        region: 'us',
        customHost: null,
        autocapture: true,
        sessionRecording: true,
        apiKeyConfigured: true,
        wouldOverrideEnv: false,
        overriddenEnvVars: [],
        updatedAt: new Date('2026-05-01T00:00:00Z'),
        updatedBy: 'admin-1',
      });

      const dto = await controller.get(res as unknown as Response);

      expect(dto.apiKeyConfigured).toBe(true);
      expect(Object.keys(dto)).not.toContain('apiKey');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('update', () => {
    it('delegates to updateSettings with the resolved input and actor id', async () => {
      const dto: UpdatePosthogSettingsDto = {
        enabled: true,
        region: 'us',
        autocapture: true,
        sessionRecording: true,
      };

      await controller.update(dto, user, res as unknown as Response);

      expect(settings.updateSettings).toHaveBeenCalledWith(
        {
          enabled: true,
          region: 'us',
          customHost: null,
          autocapture: true,
          sessionRecording: true,
        },
        'admin-1'
      );
    });

    it('passes customHost through only when region is custom', async () => {
      const dto: UpdatePosthogSettingsDto = {
        enabled: true,
        region: 'custom',
        customHost: 'https://posthog.mycompany.com',
        autocapture: false,
        sessionRecording: false,
      };

      await controller.update(dto, user, res as unknown as Response);

      expect(settings.updateSettings).toHaveBeenCalledWith(
        {
          enabled: true,
          region: 'custom',
          customHost: 'https://posthog.mycompany.com',
          autocapture: false,
          sessionRecording: false,
        },
        'admin-1'
      );
    });

    it('ignores a stale customHost when region is not custom', async () => {
      const dto: UpdatePosthogSettingsDto = {
        enabled: true,
        region: 'eu',
        customHost: 'https://leftover.example.com',
        autocapture: false,
        sessionRecording: false,
      };

      await controller.update(dto, user, res as unknown as Response);

      expect(settings.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ customHost: null }),
        'admin-1'
      );
    });
  });

  describe('setCredentials', () => {
    it('delegates to setApiKey', async () => {
      const dto: SetPosthogCredentialsDto = { apiKey: 'phc_super_secret' };

      await controller.setCredentials(dto, user, res as unknown as Response);

      expect(settings.setApiKey).toHaveBeenCalledWith('phc_super_secret', 'admin-1');
    });
  });

  describe('clearCredentials', () => {
    it('delegates to clearApiKey', async () => {
      await controller.clearCredentials(user, res as unknown as Response);

      expect(settings.clearApiKey).toHaveBeenCalledWith('admin-1');
    });
  });
});
