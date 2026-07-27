import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemConfig } from '../../system';
import { disableDemoAnalytics, initDemoIntegrations } from './init-demo-integrations';

const posthogInit = vi.fn();
const posthogOptOut = vi.fn();
vi.mock('posthog-js', () => ({
  default: { init: posthogInit, opt_out_capturing: posthogOptOut },
}));

const getDemoAnalyticsConsent = vi.fn();
vi.mock('./demo-analytics-consent', () => ({
  getDemoAnalyticsConsent: (): unknown => getDemoAnalyticsConsent(),
}));

const configuredPosthog: SystemConfig = {
  demoMode: true,
  demoIntegrations: {
    posthog: {
      key: 'phc_abc',
      host: 'https://eu.posthog.com',
      autocapture: true,
      sessionRecording: true,
    },
  },
};

describe('initDemoIntegrations', () => {
  beforeEach(() => {
    posthogInit.mockClear();
    posthogOptOut.mockClear();
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

  it('should init with password-only masking and the resolved autocapture/sessionRecording when all gates pass', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations(configuredPosthog);
    expect(posthogInit).toHaveBeenCalledWith('phc_abc', {
      api_host: 'https://eu.posthog.com',
      person_profiles: 'identified_only',
      autocapture: true,
      capture_pageview: true,
      session_recording: {
        maskAllInputs: false,
        maskInputOptions: { password: true },
      },
    });
  });

  it('should not mask rendered page text or non-password inputs (#1877)', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations(configuredPosthog);
    const [, options] = posthogInit.mock.calls[0] as [string, Record<string, unknown>];
    const sessionRecording = options.session_recording as Record<string, unknown>;
    // A regression here means replays go back to being unwatchable.
    expect(sessionRecording).not.toHaveProperty('maskTextSelector');
    expect(sessionRecording.maskAllInputs).toBe(false);
    // ...but the one guarantee that remains must hold.
    expect(sessionRecording.maskInputOptions).toEqual({ password: true });
  });

  it('should omit session_recording entirely when the resolved config disables it', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations({
      demoMode: true,
      demoIntegrations: {
        posthog: {
          key: 'phc_abc',
          host: 'https://eu.posthog.com',
          autocapture: false,
          sessionRecording: false,
        },
      },
    });
    expect(posthogInit).toHaveBeenCalledWith(
      'phc_abc',
      expect.objectContaining({ autocapture: false, session_recording: undefined }),
    );
  });
});

describe('disableDemoAnalytics', () => {
  beforeEach(() => {
    posthogInit.mockClear();
    posthogOptOut.mockClear();
    getDemoAnalyticsConsent.mockReset();
  });

  it('should opt the visitor out of capture after PostHog was initialized', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations(configuredPosthog);

    disableDemoAnalytics();

    expect(posthogOptOut).toHaveBeenCalledTimes(1);
  });
});
