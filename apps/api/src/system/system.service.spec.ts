import type { IPosthogSettingsService, ResolvedPosthogConfig } from '@openlinker/core/analytics';
import type {
  ILoginPageSettingsService,
  LoginPageCopyByLocale,
} from '@openlinker/core/login-page-settings';
import type { IDemoModeService } from '../auth/demo-mode.service.interface';
import { SystemService } from './system.service';

describe('SystemService', () => {
  const originalStorePii = process.env.OL_STORE_PII;
  const originalRegistration = process.env.OL_REGISTRATION_ENABLED;
  const NO_COPY: LoginPageCopyByLocale = { pl: {}, en: {} };

  beforeEach(() => {
    delete process.env.OL_STORE_PII;
    delete process.env.OL_REGISTRATION_ENABLED;
  });

  afterEach(() => {
    if (originalStorePii === undefined) {
      delete process.env.OL_STORE_PII;
    } else {
      process.env.OL_STORE_PII = originalStorePii;
    }
    if (originalRegistration === undefined) {
      delete process.env.OL_REGISTRATION_ENABLED;
    } else {
      process.env.OL_REGISTRATION_ENABLED = originalRegistration;
    }
  });

  function makeService(
    demoMode: boolean,
    resolvedConfig: ResolvedPosthogConfig | null = null,
    loginPage: LoginPageCopyByLocale = NO_COPY
  ): SystemService {
    const demoModeService: IDemoModeService = {
      isDemoModeEnabled: () => demoMode,
    };
    const posthogSettingsService: Partial<IPosthogSettingsService> = {
      resolveConfig: () => Promise.resolve(resolvedConfig),
    };
    const loginPageSettingsService: Partial<ILoginPageSettingsService> = {
      resolvePublicCopy: () => Promise.resolve(loginPage),
      isRegistrationEnabled: () => Promise.resolve(process.env.OL_REGISTRATION_ENABLED === 'true'),
    };
    return new SystemService(
      demoModeService,
      posthogSettingsService as IPosthogSettingsService,
      loginPageSettingsService as ILoginPageSettingsService
    );
  }

  it('should return demoMode: true when demo mode is enabled', async () => {
    await expect(makeService(true).getConfig()).resolves.toEqual({
      demoMode: true,
      storesPersonalData: true,
      registrationEnabled: false,
    });
  });

  it('should return demoMode: false when demo mode is disabled', async () => {
    await expect(makeService(false).getConfig()).resolves.toEqual({
      demoMode: false,
      storesPersonalData: true,
      registrationEnabled: false,
      loginPage: NO_COPY,
    });
  });

  it('should report storesPersonalData: true when OL_STORE_PII is unset, matching the flag default', async () => {
    await expect(makeService(false).getConfig()).resolves.toMatchObject({
      storesPersonalData: true,
    });
  });

  it('should report storesPersonalData: false when OL_STORE_PII=false', async () => {
    process.env.OL_STORE_PII = 'false';

    await expect(makeService(false).getConfig()).resolves.toEqual({
      demoMode: false,
      storesPersonalData: false,
      registrationEnabled: false,
      loginPage: NO_COPY,
    });
  });

  it('should report storesPersonalData when demo mode is on and PostHog is configured too', async () => {
    process.env.OL_STORE_PII = 'false';
    const resolvedConfig: ResolvedPosthogConfig = {
      key: 'phc_abc',
      host: 'https://eu.i.posthog.com',
      autocapture: false,
      sessionRecording: true,
      productEventsEnabled: false,
      enabledEventGroups: [],
    };

    await expect(makeService(true, resolvedConfig).getConfig()).resolves.toEqual({
      demoMode: true,
      storesPersonalData: false,
      registrationEnabled: false,
      demoIntegrations: { posthog: resolvedConfig },
    });
  });

  it('should not include demoIntegrations when demo mode is off, even if PostHog is configured', async () => {
    await expect(
      makeService(false, {
        key: 'phc_abc',
        host: 'https://eu.i.posthog.com',
        autocapture: false,
        sessionRecording: true,
        productEventsEnabled: false,
        enabledEventGroups: [],
      }).getConfig()
    ).resolves.toEqual({
      demoMode: false,
      storesPersonalData: true,
      registrationEnabled: false,
      loginPage: NO_COPY,
    });
  });

  it('should not include demoIntegrations when demo mode is on but PostHog is unconfigured', async () => {
    await expect(makeService(true, null).getConfig()).resolves.toEqual({
      demoMode: true,
      storesPersonalData: true,
      registrationEnabled: false,
    });
  });

  it('should include demoIntegrations.posthog when demo mode is on and PostHog is configured', async () => {
    const resolvedConfig: ResolvedPosthogConfig = {
      key: 'phc_abc',
      host: 'https://eu.i.posthog.com',
      autocapture: false,
      sessionRecording: true,
      productEventsEnabled: false,
      enabledEventGroups: [],
    };
    await expect(makeService(true, resolvedConfig).getConfig()).resolves.toEqual({
      demoMode: true,
      storesPersonalData: true,
      registrationEnabled: false,
      demoIntegrations: { posthog: resolvedConfig },
    });
  });

  it('should pass through autocapture and sessionRecording from the resolved config', async () => {
    const resolvedConfig: ResolvedPosthogConfig = {
      key: 'phc_abc',
      host: 'https://us.i.posthog.com',
      autocapture: true,
      sessionRecording: false,
      productEventsEnabled: false,
      enabledEventGroups: [],
    };
    await expect(makeService(true, resolvedConfig).getConfig()).resolves.toEqual({
      demoMode: true,
      storesPersonalData: true,
      registrationEnabled: false,
      demoIntegrations: { posthog: resolvedConfig },
    });
  });

  it('should report registrationEnabled: true when OL_REGISTRATION_ENABLED=true', async () => {
    process.env.OL_REGISTRATION_ENABLED = 'true';
    await expect(makeService(false).getConfig()).resolves.toMatchObject({
      registrationEnabled: true,
    });
  });

  it('should carry the login-page overrides on a real install', async () => {
    const copy: LoginPageCopyByLocale = { pl: { headline: 'Panel sprzedaży' }, en: {} };
    await expect(makeService(false, null, copy).getConfig()).resolves.toMatchObject({
      loginPage: copy,
    });
  });

  it('should omit loginPage in demo mode, whose copy is fixed in the frontend', async () => {
    const copy: LoginPageCopyByLocale = { pl: { headline: 'Panel sprzedaży' }, en: {} };
    const config = await makeService(true, null, copy).getConfig();
    expect(config).not.toHaveProperty('loginPage');
  });
});
