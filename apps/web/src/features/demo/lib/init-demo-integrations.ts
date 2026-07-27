/**
 * Init Demo Integrations
 *
 * Gated loader for demo-only third-party integrations (today: PostHog
 * session recording). `posthog-js` is dynamically imported so it is never
 * fetched on a normal (non-demo) install — the three synchronous guards
 * (demo mode, config presence, visitor consent) all run before the import.
 *
 * `autocapture` and whether session recording is enabled at all (#1685) are
 * now read from the resolved config rather than hardcoded — an admin
 * toggles them via the PostHog settings dialog on `/settings`. Masking
 * WITHIN session recording stays unconditional regardless of that toggle
 * (`maskTextSelector: '*'` masks every rendered text node), not opt-in by
 * selector: demo mode must only ever run against synthetic seed data (see
 * docs/one-command-demo-setup-guide.md), but rrweb records every rendered
 * DOM text node by default, so an operator who points a demo instance at
 * real data would otherwise ship buyer PII to PostHog cloud.
 */
import type { PostHog } from 'posthog-js';
import type { SystemConfig } from '../../system';
import { getDemoAnalyticsConsent } from './demo-analytics-consent';
import { DemoEventCatalog, type DemoEventName, type DemoEventProps } from './demo-events';

let posthogInstance: PostHog | null = null;
let productEventsEnabled = false;
let enabledEventGroups: ReadonlySet<string> = new Set();

/**
 * A `captureDemoEvent` call that lands before `initDemoIntegrations` resolves
 * (e.g. `demo_login_succeeded` firing right after login, in the same tick as
 * the app's boot-time init) is buffered here and replayed once init settles,
 * instead of being silently dropped by the `posthogInstance` guard below.
 */
let pendingEvents: Array<{ event: DemoEventName; props: unknown }> = [];
/**
 * Flips true on every exit path of `initDemoIntegrations` (early return or
 * success) so the buffer stops accepting new entries once this session's
 * init outcome is known — otherwise a long-lived non-demo/no-consent session
 * would accumulate an unbounded array from calls that will never replay.
 */
let initSettled = false;

export async function initDemoIntegrations(config: SystemConfig | undefined): Promise<void> {
  try {
    const posthogConfig = config?.demoMode ? config.demoIntegrations?.posthog : undefined;
    if (!posthogConfig?.key) {
      return;
    }

    if (getDemoAnalyticsConsent() !== 'accepted') {
      return;
    }

    const { default: posthog } = await import('posthog-js');
    posthogInstance = posthog;
    productEventsEnabled = posthogConfig.productEventsEnabled;
    enabledEventGroups = new Set(posthogConfig.enabledEventGroups);
    posthog.init(posthogConfig.key, {
      api_host: posthogConfig.host,
      person_profiles: 'identified_only',
      autocapture: posthogConfig.autocapture,
      capture_pageview: true,
      session_recording: posthogConfig.sessionRecording
        ? {
            maskAllInputs: true,
            maskTextSelector: '*',
          }
        : undefined,
    });
  } finally {
    initSettled = true;
    const buffered = pendingEvents;
    pendingEvents = [];
    for (const { event, props } of buffered) {
      captureDemoEvent(event, props as DemoEventProps<typeof event>);
    }
  }
}

/**
 * Opts the current visitor out of PostHog capture without a page reload, so
 * the in-banner "disable" affordance takes effect immediately. A no-op when
 * PostHog was never initialized (consent was never accepted this session).
 */
export function disableDemoAnalytics(): void {
  posthogInstance?.opt_out_capturing();
}

/**
 * Emits a named demo business event to PostHog. A no-op whenever PostHog was
 * never initialized this session (not demo mode, no key, or consent not
 * accepted) — mirrors `disableDemoAnalytics`'s gate on the same module-local
 * `posthogInstance` — and also a no-op when the operator has turned off
 * product events entirely, or turned off this specific event's group, via
 * the `/settings` Product-events panel (#1787).
 */
export function captureDemoEvent<E extends DemoEventName>(
  event: E,
  props: DemoEventProps<E>
): void {
  if (!posthogInstance) {
    if (!initSettled) {
      pendingEvents.push({ event, props });
    }
    return;
  }
  if (!productEventsEnabled) {
    return;
  }
  const group = DemoEventCatalog[event].group;
  if (!enabledEventGroups.has(group)) {
    return;
  }
  posthogInstance.capture(event, props);
}
