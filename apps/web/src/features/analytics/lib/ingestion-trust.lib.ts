/**
 * Ingestion Trust Helpers
 *
 * Pure derivations over the analytics data-trust snapshot. The
 * degradation-banner rule ships as a status-only check for v1 (Decision 4,
 * docs/plans/implementation-plan-analytics-page-shell.md) — the mockup's
 * range-gated "has this channel sold anything in the selected range" rule
 * is deferred until #1990 makes that fact honest rather than an
 * approximation.
 *
 * @module apps/web/src/features/analytics/lib
 */
import type { ConnectionIngestionTrust } from '../api/analytics-trust.types';

const DEGRADED_STATUSES = new Set(['stalled', 'disconnected']);

export function shouldShowDegradationBanner(
  entries: ConnectionIngestionTrust[],
): ConnectionIngestionTrust[] {
  return entries.filter((entry) => DEGRADED_STATUSES.has(entry.status));
}
