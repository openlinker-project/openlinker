/**
 * Login Page Settings Service Spec
 *
 * @module libs/core/src/login-page-settings/application/services
 */
import type { ConfigService } from '@nestjs/config';
import { LoginPageSettings } from '../../domain/entities/login-page-settings.entity';
import type { LoginPageSettingsRepositoryPort } from '../../domain/ports/login-page-settings-repository.port';
import { LoginPageSettingsService } from './login-page-settings.service';

describe('LoginPageSettingsService', () => {
  let repository: jest.Mocked<LoginPageSettingsRepositoryPort>;
  let env: Record<string, string | undefined>;
  let service: LoginPageSettingsService;

  beforeEach(() => {
    repository = {
      findSettings: jest.fn().mockResolvedValue(null),
      saveCopy: jest
        .fn()
        .mockImplementation((copy, by) =>
          Promise.resolve(new LoginPageSettings(copy, new Date(), by))
        ),
    };
    env = {};
    const config = { get: jest.fn((name: string) => env[name]) } as unknown as ConfigService;
    service = new LoginPageSettingsService(repository, config);
  });

  it('should report every field as default when no row and no env exist', async () => {
    const view = await service.resolve();
    expect(view.copy.pl.headline).toEqual({ value: null, source: 'default' });
    expect(view.updatedAt).toBeNull();
    await expect(service.resolvePublicCopy()).resolves.toEqual({ pl: {}, en: {} });
  });

  it('should merge a write onto the stored row when saving', async () => {
    repository.findSettings.mockResolvedValue(
      new LoginPageSettings({ pl: { headline: 'Panel' }, en: {} }, new Date(), 'u1')
    );
    await service.updateSettings({ en: { headline: 'Sales panel' } }, 'u2');
    expect(repository.saveCopy).toHaveBeenCalledWith(
      { pl: { headline: 'Panel' }, en: { headline: 'Sales panel' } },
      'u2'
    );
  });

  it('should expose an env override publicly when no row value exists', async () => {
    env.OL_LOGIN_HEADLINE_PL = 'Panel z env';
    await expect(service.resolvePublicCopy()).resolves.toEqual({
      pl: { headline: 'Panel z env' },
      en: {},
    });
  });
});
