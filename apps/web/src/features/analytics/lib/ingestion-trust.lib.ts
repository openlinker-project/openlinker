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
import type { ConnectionIngestionStatus, ConnectionIngestionTrust } from '../api/analytics-trust.types';

// `unknown` (a per-connection build failure — the worst status per
// `computeWorstStatus`'s own ranking) is deliberately excluded: it isn't
// the operator's fault and there's nothing to act on beyond what the trust
// header already shows, so banner-worthy is a narrower set than
// worst-status (#2098 tech review).
const DEGRADED_STATUSES = new Set<ConnectionIngestionStatus>(['stalled', 'disconnected']);

/**
 * Returns the subset of connections whose ingestion is degraded — never a
 * boolean. Named for what it returns (not `shouldShow*`, which every
 * plain-`if` caller would misread as truthy on a non-empty *or* the
 * always-truthy array itself).
 */
export function selectDegradedConnections(
  entries: ConnectionIngestionTrust[],
): ConnectionIngestionTrust[] {
  return entries.filter((entry) => DEGRADED_STATUSES.has(entry.status));
}

/**
 * The earliest order date across the given connections — scoped to one
 * connection when `sourceConnectionId` is set, mirroring the same filter
 * `GET /analytics/sales` itself respects, so "how far back can we compare"
 * never disagrees with "which connections the figures actually cover".
 * `null` when nothing has ever been ingested in scope (or a specific
 * `sourceConnectionId` matches no connection / has never ingested).
 */
export function resolveEarliestOrderDate(
  connections: ConnectionIngestionTrust[],
  sourceConnectionId?: string,
): string | null {
  const scoped = sourceConnectionId
    ? connections.filter((c) => c.connectionId === sourceConnectionId)
    : connections;
  const dates = scoped
    .map((c) => c.earliestOrderDate)
    .filter((d): d is string => d !== null);
  if (dates.length === 0) return null;
  return dates.reduce((earliest, date) => (date < earliest ? date : earliest));
}
