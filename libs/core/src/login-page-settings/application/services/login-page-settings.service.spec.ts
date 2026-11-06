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
      saveSettings: jest
        .fn()
        .mockImplementation(
          (
            settings: Parameters<LoginPageSettingsRepositoryPort['saveSettings']>[0],
            by: string | null
          ) =>
            Promise.resolve(
              new LoginPageSettings(settings.copy, settings.registrationEnabled, new Date(), by)
            )
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
      new LoginPageSettings({ pl: { headline: 'Panel' }, en: {} }, null, new Date(), 'u1')
    );
    await service.updateSettings({ en: { headline: 'Sales panel' } }, 'u2');
    expect(repository.saveSettings).toHaveBeenCalledWith(
      {
        copy: { pl: { headline: 'Panel' }, en: { headline: 'Sales panel' } },
        registrationEnabled: null,
      },
      'u2'
    );
  });

  it('should sanitize the support line and clear it when the editor sends no text', async () => {
    await service.updateSettings(
      {
        pl: {
          support:
            '<p>Pomoc: <a href="https://help.example" onclick="x()">tutaj</a><script>x()</script></p>',
        },
        en: { support: '<p></p>' },
      },
      'u1'
    );
    const saved = repository.saveSettings.mock.calls[0]?.[0];
    expect(saved?.copy.pl.support).toContain('<a href="https://help.example">tutaj</a>');
    expect(saved?.copy.pl.support).not.toMatch(/onclick|script/);
    expect(saved?.copy.en.support).toBeUndefined();
  });

  it('should prefer the stored registration choice over env', async () => {
    env.OL_REGISTRATION_ENABLED = 'true';
    await expect(service.isRegistrationEnabled()).resolves.toBe(true);
    repository.findSettings.mockResolvedValue(
      new LoginPageSettings({ pl: {}, en: {} }, false, new Date(), 'u1')
    );
    await expect(service.isRegistrationEnabled()).resolves.toBe(false);
    expect((await service.resolve()).registration).toEqual({ value: false, source: 'setting' });
  });

  it('should keep the stored registration choice when a write leaves it out', async () => {
    repository.findSettings.mockResolvedValue(
      new LoginPageSettings({ pl: {}, en: {} }, true, new Date(), 'u1')
    );
    await service.updateSettings({ pl: { headline: 'x' } }, 'u2');
    expect(repository.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ registrationEnabled: true }),
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
