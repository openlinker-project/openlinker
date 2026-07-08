import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemConfig } from '../../system';
import { initDemoIntegrations } from './init-demo-integrations';

const posthogInit = vi.fn();
vi.mock('posthog-js', () => ({
  default: { init: posthogInit },
}));

const getDemoAnalyticsConsent = vi.fn();
vi.mock('./demo-analytics-consent', () => ({
  getDemoAnalyticsConsent: (): unknown => getDemoAnalyticsConsent(),
}));

const configuredPosthog: SystemConfig = {
  demoMode: true,
  demoIntegrations: { posthog: { key: 'phc_abc', host: 'https://eu.posthog.com' } },
};

describe('initDemoIntegrations', () => {
  beforeEach(() => {
    posthogInit.mockClear();
    getDemoAnalyticsConsent.mockReset();
  });

  it('should not init when demoMode is false', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations({ ...configuredPosthog, demoMode: false });
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it('should not init when demoMode is true but no posthog key is configured', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations({ demoMode: true });
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it('should not init when config is present but consent is not accepted', async () => {
    getDemoAnalyticsConsent.mockReturnValue(null);
    await initDemoIntegrations(configuredPosthog);
    expect(posthogInit).not.toHaveBeenCalled();

    getDemoAnalyticsConsent.mockReturnValue('declined');
    await initDemoIntegrations(configuredPosthog);
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it('should not init when config is undefined', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations(undefined);
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it('should init with masking options when all gates pass', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations(configuredPosthog);
    expect(posthogInit).toHaveBeenCalledWith('phc_abc', {
      api_host: 'https://eu.posthog.com',
      person_profiles: 'identified_only',
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '[data-ph-mask]',
      },
    });
  });
});
