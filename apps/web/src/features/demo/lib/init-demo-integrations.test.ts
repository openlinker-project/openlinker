import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemConfig } from '../../system';
import { captureDemoEvent, initDemoIntegrations } from './init-demo-integrations';

const posthogInit = vi.fn();
const posthogCapture = vi.fn();
vi.mock('posthog-js', () => ({
  default: {
    init: posthogInit,
    capture: posthogCapture,
  },
}));

const configuredPosthog: SystemConfig = {
  demoMode: true,
  demoIntegrations: {
    posthog: {
      key: 'phc_abc',
      host: 'https://eu.posthog.com',
      autocapture: true,
      sessionRecording: true,
      productEventsEnabled: true,
      enabledEventGroups: ['conversion-intent'],
    },
  },
};

describe('captureDemoEvent', () => {
  beforeEach(() => {
    posthogInit.mockClear();
      posthogCapture.mockClear();
  });

  it('should not call posthog.capture when PostHog was never initialized', () => {
    captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' });

    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it('should not call posthog.capture when initialization was gated out (no consent)', async () => {
    await initDemoIntegrations(configuredPosthog, false);

    captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' });

    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it('should call posthog.capture with the event name and props once PostHog is initialized', async () => {
        await initDemoIntegrations(configuredPosthog, true);

    captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' });

    expect(posthogCapture).toHaveBeenCalledWith('demo_viewer_locked_action_clicked', {
      actionName: 'a',
      surface: 'b',
    });
  });

  it('should not call posthog.capture when productEventsEnabled is false', async () => {
        await initDemoIntegrations({
      ...configuredPosthog,
      demoIntegrations: {
        posthog: {
          ...configuredPosthog.demoIntegrations!.posthog!,
          productEventsEnabled: false,
        },
      },
    }, true);

    captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' });

    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it("should not call posthog.capture when the event's group is not in enabledEventGroups", async () => {
        await initDemoIntegrations({
      ...configuredPosthog,
      demoIntegrations: {
        posthog: {
          ...configuredPosthog.demoIntegrations!.posthog!,
          enabledEventGroups: ['some-other-group'],
        },
      },
    }, true);

    captureDemoEvent('demo_viewer_locked_action_clicked', { actionName: 'a', surface: 'b' });

    expect(posthogCapture).not.toHaveBeenCalled();
  });
});

describe('initDemoIntegrations', () => {
  beforeEach(() => {
    posthogInit.mockClear();
      posthogCapture.mockClear();
  });

  it('should not init when demoMode is false', async () => {
        await initDemoIntegrations({ ...configuredPosthog, demoMode: false }, true);
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it('should not init when demoMode is true but no posthog key is configured', async () => {
        await initDemoIntegrations({ demoMode: true }, true);
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it('should not init when config is present but the account has not consented (#1938)', async () => {
    await initDemoIntegrations(configuredPosthog, false);
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it('should not init when config is undefined', async () => {
        await initDemoIntegrations(undefined, true);
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it('should init with password-only masking and the resolved autocapture/sessionRecording when all gates pass', async () => {
        await initDemoIntegrations(configuredPosthog, true);
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
        await initDemoIntegrations(configuredPosthog, true);
    const [, options] = posthogInit.mock.calls[0] as [string, Record<string, unknown>];
    const sessionRecording = options.session_recording as Record<string, unknown>;
    // A regression here means replays go back to being unwatchable.
    expect(sessionRecording).not.toHaveProperty('maskTextSelector');
    expect(sessionRecording.maskAllInputs).toBe(false);
    // ...but the one guarantee that remains must hold.
    expect(sessionRecording.maskInputOptions).toEqual({ password: true });
  });

  it('should omit session_recording entirely when the resolved config disables it', async () => {
        await initDemoIntegrations({
      demoMode: true,
      demoIntegrations: {
        posthog: {
          key: 'phc_abc',
          host: 'https://eu.posthog.com',
          autocapture: false,
          sessionRecording: false,
          productEventsEnabled: false,
          enabledEventGroups: [],
        },
      },
    }, true);
    expect(posthogInit).toHaveBeenCalledWith(
      'phc_abc',
      expect.objectContaining({ autocapture: false, session_recording: undefined }),
    );
  });
});

describe('captureDemoEvent buffering before init resolves (#1790)', () => {
  beforeEach(() => {
    posthogInit.mockClear();
      posthogCapture.mockClear();
  });

  it('replays a captureDemoEvent call issued before initDemoIntegrations resolves, once init succeeds', async () => {
    vi.resetModules();
    const mod = await import('./init-demo-integrations');
    
    const configWithBaseline: SystemConfig = {
      ...configuredPosthog,
      demoIntegrations: {
        posthog: {
          ...configuredPosthog.demoIntegrations!.posthog!,
          enabledEventGroups: ['baseline'],
        },
      },
    };

    // `initDemoIntegrations` runs synchronously up to its first `await` (the
    // dynamic `posthog-js` import), so `posthogInstance` is still null here —
    // this call must be buffered, not dropped.
    const initPromise = mod.initDemoIntegrations(configWithBaseline, true);
    mod.captureDemoEvent('demo_login_succeeded', { role: 'admin' });
    await initPromise;

    expect(posthogCapture).toHaveBeenCalledWith('demo_login_succeeded', { role: 'admin' });
  });

  it('never replays a buffered event once init has settled to a non-demo outcome, even across a later successful init', async () => {
    vi.resetModules();
    const mod = await import('./init-demo-integrations');
    
    // Resolves via the early-return (not demo mode) path, flipping the
    // one-shot `initSettled` flag.
    await mod.initDemoIntegrations({ demoMode: false }, true);
    mod.captureDemoEvent('demo_login_succeeded', { role: 'admin' });

    // A later, separate successful init in the same session must not replay
    // an event that arrived after the session's outcome was already settled.
    await mod.initDemoIntegrations(configuredPosthog, true);

    expect(posthogCapture).not.toHaveBeenCalledWith(
      'demo_login_succeeded',
      expect.anything(),
    );
  });
});
