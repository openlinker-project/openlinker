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
 * @module apps/web/src/pages/inventory
 */
import type { ReactElement } from 'react';
import { PageLayout } from '../../shared/ui/page-layout';
import { KpiCard } from '../../shared/ui/kpi-card';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { StatusBadge } from '../../shared/ui/status-badge';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { useDuplicatePositionsQuery } from '../../features/inventory/hooks/use-duplicate-positions-query';
import { useProvenanceBackfillStatusQuery } from '../../features/inventory/hooks/use-provenance-backfill-status-query';

export function DuplicatePositionsPage(): ReactElement {
  const duplicatesQuery = useDuplicatePositionsQuery();
  const provenanceQuery = useProvenanceBackfillStatusQuery();

  const report = duplicatesQuery.data;
  const provenance = provenanceQuery.data;

  const isLoading = duplicatesQuery.isLoading || provenanceQuery.isLoading;
  const error = duplicatesQuery.error ?? provenanceQuery.error;

  // Both reads must have settled before either readiness condition can be
  // stated — a single `undefined` here must never be read as "not ready".
  const noDuplicateGroups = report ? report.groupCount === 0 : undefined;
  const backfillComplete = provenance ? provenance.completed : undefined;
  const isReady =
    noDuplicateGroups !== undefined && backfillComplete !== undefined
      ? noDuplicateGroups && backfillComplete
      : undefined;

  const retry = (): void => {
    void duplicatesQuery.refetch();
    void provenanceQuery.refetch();
  };

  return (
    <PageLayout
      eyebrow="Diagnostics"
      title="Duplicate stock positions"
      description={
        'Read-only readiness check for the stricter inventory_items uniqueness index. ' +
        'Detects duplicate stock positions — it never repairs them.'
      }
    >
      {isLoading ? (
        <LoadingState
          liveRegion="off"
          title="Loading duplicate-position report"
          message="Scanning inventory_items for colliding position keys and checking the provenance backfill..."
        />
      ) : error ? (
        <ErrorState
          title="Unable to load the duplicate-position report"
          message={error.message}
          action={<Button onClick={retry}>Retry</Button>}
        />
      ) : report && provenance ? (
        <>
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
                <StatusBadge tone={backfillComplete ? 'success' : 'warning'} withDot>
                  {backfillComplete ? 'Done' : 'Pending'}
                </StatusBadge>
                <span>
                  {backfillComplete
                    ? '#2317 provenance backfill complete'
                    : `#2317 provenance backfill still running (${String(provenance.remainingNull)} row(s) remaining)`}
                </span>
              </li>
            </ul>
            {!isReady ? (
              <p className="duplicate-positions-checklist__footnote">
                Both conditions must hold before the stricter uniqueness index (#2325) can be
                built. See docs/operations/inventory-duplicate-positions.md for the remediation
                procedure.
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
              tone={backfillComplete ? 'success' : 'warning'}
              description="#2317 inventory_items rows still missing sourceConnectionId."
            />
          </div>
        </>
      ) : null}
    </PageLayout>
  );
}
