/**
 * Duplicate Positions Page
 *
 * Read-only operator diagnostic for the #2325 stricter `inventory_items`
 * uniqueness index. Detects only: nothing here writes anything, and
 * remediation is a manual DB operation documented in
 * `docs/operations/inventory-duplicate-positions.md`.
 *
 * Readiness for #2325 depends on TWO independent conditions (#3240):
 * 1. `GET /inventory/duplicate-positions` (#2319) reports `groupCount: 0` —
 *    no colliding position keys.
 * 2. `GET /inventory/provenance-backfill-status` (#3240) reports
 *    `completed: true` — the #2317 backfill has fully drained. A scan taken
 *    while it is still mid-run can read `groupCount: 0` and then flip
 *    non-zero once NULL rows collapse to `'legacy'` and reveal a collision
 *    the scan couldn't see yet, so BOTH conditions must hold, not just one.
 *
 * `groupCount` / `rowCount` / `excessRowCount` are UNCAPPED — they always
 * describe the whole table, even when `groups[]` (and therefore the table
 * below) is truncated to the largest `maxGroups` groups (the truncated-report
 * banner is added in #3075).
 *
 * The backing endpoints are `@Roles('admin')`-gated server-side, and the
 * page gates itself the same way — rendering an access-denied state for a
 * non-admin session rather than relying on a sibling PR's nav gate, which
 * covers only the nav affordance and not a direct navigation to this route
 * (`docs/frontend-architecture.md` § Access Control And UI Visibility).
 *
 * @module apps/web/src/pages/inventory
 */
import type { ReactElement } from 'react';
import { PageLayout } from '../../shared/ui/page-layout';
import { KpiCard } from '../../shared/ui/kpi-card';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { StatusBadge } from '../../shared/ui/status-badge';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { formatDateTime } from '../../shared/format/format-date';
import { useSession } from '../../shared/auth/use-session';
import { useIsAdmin } from '../../shared/auth/use-permission';
import { useDuplicatePositionsQuery } from '../../features/inventory/hooks/use-duplicate-positions-query';
import { useProvenanceBackfillStatusQuery } from '../../features/inventory/hooks/use-provenance-backfill-status-query';

export function DuplicatePositionsPage(): ReactElement {
  const { isReady: isSessionReady } = useSession();
  const isAdmin = useIsAdmin();
  const duplicatesQuery = useDuplicatePositionsQuery();
  const provenanceQuery = useProvenanceBackfillStatusQuery();

  const report = duplicatesQuery.data;
  const provenance = provenanceQuery.data;

  const isLoading = duplicatesQuery.isLoading || provenanceQuery.isLoading;
  const error = duplicatesQuery.error ?? provenanceQuery.error;
  // A failed *refresh* of an already-loaded report must not blank the
  // screen — TanStack Query keeps `data` from the last success while
  // `error` is set on a refetch, so only route to the full-page ErrorState
  // when there is no report to fall back on (tech-review of #3252).
  const hasLoadedReport = report !== undefined && provenance !== undefined;
  const initialLoadError = !hasLoadedReport ? error : undefined;
  const refreshError = hasLoadedReport ? error : undefined;

  // Both reads must have settled before either readiness condition can be
  // stated — a single `undefined` here must never be read as "not ready".
  const noDuplicateGroups = report ? report.groupCount === 0 : undefined;
  const backfillComplete = provenance ? provenance.completed : undefined;
  const isReady =
    noDuplicateGroups !== undefined && backfillComplete !== undefined
      ? noDuplicateGroups && backfillComplete
      : undefined;
  // `latchedAt` is the only field that tells "still draining" apart from
  // "latched, and stuck" (see the field's own docblock in inventory.types.ts)
  // — a backfill that stopped on its own needs an operator to re-arm it,
  // while one still running just needs time. Collapsing both into "Pending"
  // told the operator to wait on a number that would never move. Holding the
  // timestamp itself (rather than a bare boolean) is what lets TypeScript
  // narrow it below without a cast.
  const stuckSinceLatchedAt: string | null =
    provenance && provenance.remainingNull > 0 ? provenance.latchedAt : null;
  const provenanceLatchedAndStuck = stuckSinceLatchedAt !== null;

  const isFetching = duplicatesQuery.isFetching || provenanceQuery.isFetching;

  const retry = (): void => {
    void duplicatesQuery.refetch();
    void provenanceQuery.refetch();
  };

  if (isSessionReady && !isAdmin) {
    return (
      <PageLayout
        eyebrow="Diagnostics"
        title="Duplicate stock positions"
        description="Admin-only access."
      >
        <ErrorState
          title="Admin role required"
          message="This diagnostic reads inventory_items directly — it requires an admin session."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow="Diagnostics"
      title="Duplicate stock positions"
      description={
        'Read-only readiness check for the stricter inventory_items uniqueness index. ' +
        'Detects duplicate stock positions — it never repairs them.'
      }
      actions={
        hasLoadedReport ? (
          <Button onClick={retry} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        ) : undefined
      }
    >
      {!isSessionReady || isLoading ? (
        <LoadingState
          title="Loading duplicate-position report"
          message="Scanning inventory_items for colliding position keys and checking the provenance backfill..."
        />
      ) : initialLoadError ? (
        <ErrorState
          title="Unable to load the duplicate-position report"
          message={initialLoadError.message}
          action={<Button onClick={retry}>Retry</Button>}
        />
      ) : report && provenance ? (
        <>
          {refreshError ? (
            <Alert tone="error" title="Refresh failed">
              {refreshError.message} — showing the last successful scan below.
            </Alert>
          ) : null}
          <p className="duplicate-positions-generated-at">
            As of {formatDateTime(report.generatedAt)}
          </p>
          <Alert tone={isReady ? 'success' : 'warning'} title={isReady ? 'Ready' : 'Not ready'}>
            <ul className="duplicate-positions-checklist">
              <li>
                <StatusBadge tone={noDuplicateGroups ? 'success' : 'error'} withDot>
                  {noDuplicateGroups ? 'Done' : 'Pending'}
                </StatusBadge>
                <span>
                  {noDuplicateGroups
                    ? 'No duplicate position groups'
                    : `${String(report.groupCount)} duplicate position group(s) must be resolved`}
                </span>
              </li>
              <li>
                <StatusBadge
                  tone={backfillComplete ? 'success' : provenanceLatchedAndStuck ? 'error' : 'warning'}
                  withDot
                >
                  {backfillComplete ? 'Done' : provenanceLatchedAndStuck ? 'Stuck' : 'Pending'}
                </StatusBadge>
                <span>
                  {backfillComplete
                    ? 'Provenance backfill complete'
                    : stuckSinceLatchedAt !== null
                      ? `${String(provenance.remainingNull)} row(s) still missing provenance — the backfill ` +
                        `latched on ${formatDateTime(stuckSinceLatchedAt)} and has stopped running. ` +
                        'It will not resume on its own — ask an engineer to re-arm it.'
                      : `${String(provenance.remainingNull)} row(s) still missing provenance`}
                </span>
              </li>
            </ul>
            {!isReady ? (
              <p className="duplicate-positions-checklist__footnote">
                Both conditions must hold before the stricter uniqueness index can be built.
                Resolving duplicate groups is a manual database operation — ask an engineer to run
                the remediation procedure, then refresh this page to re-check.
              </p>
            ) : null}
          </Alert>

          <div className="ds-grid ds-grid--4">
            <KpiCard
              label="Duplicate groups"
              value={report.groupCount}
              tone={noDuplicateGroups ? 'success' : 'error'}
            />
            <KpiCard label="Total rows in duplicate groups" value={report.rowCount} tone="neutral" />
            <KpiCard
              label="Excess rows"
              value={report.excessRowCount}
              tone={report.excessRowCount === 0 ? 'success' : 'warning'}
              description="Rows that must be removed before the index can build — one row per group survives."
            />
            <KpiCard
              label="Provenance rows remaining"
              value={provenance.remainingNull}
              tone={backfillComplete ? 'success' : provenanceLatchedAndStuck ? 'error' : 'warning'}
              description={
                provenanceLatchedAndStuck
                  ? 'inventory_items rows still missing sourceConnectionId — backfill latched, needs re-arming.'
                  : 'inventory_items rows still missing sourceConnectionId.'
              }
            />
          </div>
        </>
      ) : null}
    </PageLayout>
  );
}
