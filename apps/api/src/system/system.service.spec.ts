import type { IDemoModeService } from '../auth/demo-mode.service.interface';
import type { IPosthogConfigService, PosthogConfig } from './posthog-config.service.interface';
import { SystemService } from './system.service';

describe('SystemService', () => {
  function makeService(
    demoMode: boolean,
    posthogConfig: PosthogConfig | null = null,
  ): SystemService {
    const demoModeService: IDemoModeService = {
      isDemoModeEnabled: () => demoMode,
    };
    const posthogConfigService: IPosthogConfigService = {
      getConfig: () => posthogConfig,
    };
    return new SystemService(demoModeService, posthogConfigService);
  }

  it('should return demoMode: true when demo mode is enabled', () => {
    expect(makeService(true).getConfig()).toEqual({ demoMode: true });
  });

  it('should return demoMode: false when demo mode is disabled', () => {
    expect(makeService(false).getConfig()).toEqual({ demoMode: false });
  });

  it('should not include demoIntegrations when demo mode is off, even if PostHog is configured', () => {
    expect(
      makeService(false, { key: 'phc_abc', host: 'https://eu.posthog.com' }).getConfig(),
    ).toEqual({ demoMode: false });
  });

  it('should not include demoIntegrations when demo mode is on but PostHog is unconfigured', () => {
    expect(makeService(true, null).getConfig()).toEqual({ demoMode: true });
  });

  it('should include demoIntegrations.posthog when demo mode is on and PostHog is configured', () => {
    const posthogConfig: PosthogConfig = { key: 'phc_abc', host: 'https://eu.posthog.com' };
    expect(makeService(true, posthogConfig).getConfig()).toEqual({
      demoMode: true,
      demoIntegrations: { posthog: posthogConfig },
    });
  });
});
