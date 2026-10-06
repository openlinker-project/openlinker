import type { IPosthogSettingsService, ResolvedPosthogConfig } from '@openlinker/core/analytics';
import type { IDemoModeService } from '../auth/demo-mode.service.interface';
import { SystemService } from './system.service';

describe('SystemService', () => {
  const originalStorePii = process.env.OL_STORE_PII;

  beforeEach(() => {
    delete process.env.OL_STORE_PII;
  });

  afterEach(() => {
    if (originalStorePii === undefined) {
      delete process.env.OL_STORE_PII;
    } else {
      process.env.OL_STORE_PII = originalStorePii;
    }
  });

  function makeService(
    demoMode: boolean,
    resolvedConfig: ResolvedPosthogConfig | null = null,
  ): SystemService {
    const demoModeService: IDemoModeService = {
      isDemoModeEnabled: () => demoMode,
    };
    const posthogSettingsService: Partial<IPosthogSettingsService> = {
      resolveConfig: () => Promise.resolve(resolvedConfig),
    };
    return new SystemService(
      demoModeService,
      posthogSettingsService as IPosthogSettingsService,
    );
  }

  it('should return demoMode: true when demo mode is enabled', async () => {
    await expect(makeService(true).getConfig()).resolves.toEqual({
      demoMode: true,
      storesPersonalData: true,
    });
  });

  it('should return demoMode: false when demo mode is disabled', async () => {
    await expect(makeService(false).getConfig()).resolves.toEqual({
      demoMode: false,
      storesPersonalData: true,
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
      }).getConfig(),
    ).resolves.toEqual({ demoMode: false, storesPersonalData: true });
  });

  it('should not include demoIntegrations when demo mode is on but PostHog is unconfigured', async () => {
    await expect(makeService(true, null).getConfig()).resolves.toEqual({
      demoMode: true,
      storesPersonalData: true,
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
      demoIntegrations: { posthog: resolvedConfig },
    });
  });
});
