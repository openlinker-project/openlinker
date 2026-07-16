import type { IPosthogSettingsService, ResolvedPosthogConfig } from '@openlinker/core/analytics';
import type { IDemoModeService } from '../auth/demo-mode.service.interface';
import { SystemService } from './system.service';

describe('SystemService', () => {
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
    await expect(makeService(true).getConfig()).resolves.toEqual({ demoMode: true });
  });

  it('should return demoMode: false when demo mode is disabled', async () => {
    await expect(makeService(false).getConfig()).resolves.toEqual({ demoMode: false });
  });

  it('should not include demoIntegrations when demo mode is off, even if PostHog is configured', async () => {
    await expect(
      makeService(false, {
        key: 'phc_abc',
        host: 'https://eu.i.posthog.com',
        autocapture: false,
        sessionRecording: true,
      }).getConfig(),
    ).resolves.toEqual({ demoMode: false });
  });

  it('should not include demoIntegrations when demo mode is on but PostHog is unconfigured', async () => {
    await expect(makeService(true, null).getConfig()).resolves.toEqual({ demoMode: true });
  });

  it('should include demoIntegrations.posthog when demo mode is on and PostHog is configured', async () => {
    const resolvedConfig: ResolvedPosthogConfig = {
      key: 'phc_abc',
      host: 'https://eu.i.posthog.com',
      autocapture: false,
      sessionRecording: true,
    };
    await expect(makeService(true, resolvedConfig).getConfig()).resolves.toEqual({
      demoMode: true,
      demoIntegrations: { posthog: resolvedConfig },
    });
  });

  it('should pass through autocapture and sessionRecording from the resolved config', async () => {
    const resolvedConfig: ResolvedPosthogConfig = {
      key: 'phc_abc',
      host: 'https://us.i.posthog.com',
      autocapture: true,
      sessionRecording: false,
    };
    await expect(makeService(true, resolvedConfig).getConfig()).resolves.toEqual({
      demoMode: true,
      demoIntegrations: { posthog: resolvedConfig },
    });
  });
});
