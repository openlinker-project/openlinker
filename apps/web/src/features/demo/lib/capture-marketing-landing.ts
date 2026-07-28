/**
 * Capture Marketing Landing
 *
 * Fire-and-forget UTM/campaign attribution for a visitor's FIRST landing hit
 * on a demo instance — independent of the analytics-consent gate that guards
 * `initDemoIntegrations` (session recording + full posthog-js SDK). That gate
 * exists because session recording plays back page content, which is far
 * more privacy-sensitive than a single de-identified attribution event; this
 * capture carries none of that weight, so it is not subject to the same
 * gate:
 *
 * - never loads `posthog-js` — a single `fetch` to PostHog's REST capture
 *   endpoint, so autocapture/session-recording code never reaches the page
 * - never persists a person profile (`$process_person_profile: false`) or a
 *   durable distinct_id — a fresh random id per landing, kept only in
 *   `sessionStorage` for this tab's de-dup, never written to a durable
 *   PostHog cookie
 * - fires only when the URL actually carries a `utm_*` param — a plain visit
 *   with no campaign context emits nothing
 *
 * This is deliberately narrower than "track all anonymous traffic" — it
 * exists to answer one question (which campaign drove this visit), not to
 * build a pre-consent behavioral profile.
 *
 * @module features/demo/lib
 */
import type { PosthogDemoIntegration, SystemConfig } from '../../system';
import { MARKETING_LANDING_CAPTURED_STORAGE_KEY } from '../demo.types';

const UTM_PARAM_NAMES = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

function readUtmParams(search: string): Record<string, string> | null {
  const params = new URLSearchParams(search);
  const utmProps: Record<string, string> = {};
  for (const name of UTM_PARAM_NAMES) {
    const value = params.get(name);
    if (value) {
      utmProps[name] = value;
    }
  }
  return Object.keys(utmProps).length > 0 ? utmProps : null;
}

/**
 * Pure presence check, reused by both the capture side-effect below and the
 * campaign-tracking disclosure footnote (#1892) so the two never drift on
 * what counts as "arrived via a marketing link".
 */
export function hasMarketingUtmParams(search: string): boolean {
  return readUtmParams(search) !== null;
}

function resolvePosthogCaptureConfig(
  config: SystemConfig | undefined
): PosthogDemoIntegration | undefined {
  return config?.demoMode ? config.demoIntegrations?.posthog : undefined;
}

/**
 * Whether a page load would actually trigger `captureMarketingLanding` —
 * i.e. demo mode is on, PostHog is configured, the URL carries a UTM param,
 * and this tab hasn't already captured a landing. Consumed by the /login and
 * /register footnote so it never claims a capture happened (or will happen)
 * when the underlying capture would actually no-op — e.g. a same-tab reload
 * or back-navigation after the tab's one-per-tab capture already fired.
 */
export function isMarketingLandingTrackable(
  config: SystemConfig | undefined,
  search: string
): boolean {
  return (
    Boolean(resolvePosthogCaptureConfig(config)?.key) &&
    hasMarketingUtmParams(search) &&
    !alreadyCapturedThisTab()
  );
}

function alreadyCapturedThisTab(): boolean {
  try {
    return window.sessionStorage.getItem(MARKETING_LANDING_CAPTURED_STORAGE_KEY) === '1';
  } catch {
    // Storage unavailable (private browsing) — proceed rather than silently
    // drop every landing capture for that visitor.
    return false;
  }
}

function markCapturedThisTab(): void {
  try {
    window.sessionStorage.setItem(MARKETING_LANDING_CAPTURED_STORAGE_KEY, '1');
  } catch {
    // Best-effort de-dup only; a missed write just risks one duplicate event.
  }
}

export function captureMarketingLanding(config: SystemConfig | undefined): void {
  const posthogConfig = resolvePosthogCaptureConfig(config);
  if (!posthogConfig?.key) {
    return;
  }

  if (alreadyCapturedThisTab()) {
    return;
  }

  const utmProps = readUtmParams(window.location.search);
  if (!utmProps) {
    return;
  }

  markCapturedThisTab();

  const body = JSON.stringify({
    api_key: posthogConfig.key,
    event: 'demo_marketing_landing',
    distinct_id: crypto.randomUUID(),
    properties: {
      ...utmProps,
      $current_url: window.location.href,
      $referrer: document.referrer || undefined,
      $process_person_profile: false,
    },
  });

  void fetch(`${posthogConfig.host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Best-effort — marketing attribution must never affect the app boot path.
  });
}
