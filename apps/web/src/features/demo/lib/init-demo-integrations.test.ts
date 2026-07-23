import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemConfig } from '../../system';
import { captureDemoEvent, disableDemoAnalytics, initDemoIntegrations } from './init-demo-integrations';

const posthogInit = vi.fn();
const posthogOptOut = vi.fn();
const posthogCapture = vi.fn();
vi.mock('posthog-js', () => ({
  default: { init: posthogInit, opt_out_capturing: posthogOptOut, capture: posthogCapture },
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

describe('captureDemoEvent', () => {
  beforeEach(() => {
    posthogInit.mockClear();
    posthogOptOut.mockClear();
    posthogCapture.mockClear();
    getDemoAnalyticsConsent.mockReset();
  });

  it('should not call posthog.capture when PostHog was never initialized', () => {
    captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' });

    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it('should not call posthog.capture when initialization was gated out (consent declined)', async () => {
    getDemoAnalyticsConsent.mockReturnValue('declined');
    await initDemoIntegrations(configuredPosthog);

    captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' });

    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it('should call posthog.capture with the event name and props once PostHog is initialized', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations(configuredPosthog);

    captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' });

    expect(posthogCapture).toHaveBeenCalledWith('demo_viewer_locked_action_clicked', {
      actionName: 'a',
      surface: 'b',
    });
  });
});

describe('initDemoIntegrations', () => {
  beforeEach(() => {
    posthogInit.mockClear();
    posthogOptOut.mockClear();
    posthogCapture.mockClear();
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

  it('should init with masking options and the resolved autocapture/sessionRecording when all gates pass', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations(configuredPosthog);
    expect(posthogInit).toHaveBeenCalledWith('phc_abc', {
      api_host: 'https://eu.posthog.com',
      person_profiles: 'identified_only',
      autocapture: true,
      capture_pageview: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
      },
    });
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
    posthogCapture.mockClear();
    getDemoAnalyticsConsent.mockReset();
  });

  it('should opt the visitor out of capture after PostHog was initialized', async () => {
    getDemoAnalyticsConsent.mockReturnValue('accepted');
    await initDemoIntegrations(configuredPosthog);

    disableDemoAnalytics();

    expect(posthogOptOut).toHaveBeenCalledTimes(1);
  });
});
