/**
 * Duplicate Positions Page
 *
 * Read-only operator diagnostic for the #2325 stricter `inventory_items`
 * uniqueness index. Detects only: nothing here writes anything, and
 * remediation is a manual DB operation documented in
 * `docs/operations/inventory-duplicate-positions.md` (also reachable
 * in-product via the "Remediation guide" links, which open a condensed
 * modal before falling through to the full runbook).
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
 * below) is truncated to the largest `maxGroups` groups. Provenance is part
 * of the position key (ADR-058): two rows differing only by source
 * connection are legitimate coexisting mirrors, not duplicates, and are
 * already excluded from `groupCount` before it ever reaches this page.
 *
 * The backing endpoint (`GET /inventory/duplicate-positions`) is
 * `@Roles('admin')`-gated server-side. This page has no route/nav entry yet
 * — whichever PR wires one (#3074) MUST gate its `requiresRole: 'admin'` nav
 * contribution (or wrap the route) so a non-admin session never reaches a
 * bare 403 `ErrorState` here; backend authorization is a separate axis from
 * frontend visibility (`docs/frontend-architecture.md` § Access Control And
 * UI Visibility).
 *
 * @module apps/web/src/pages/inventory
 */
import { useMemo, useState, type ReactElement } from 'react';
import { PageLayout } from '../../shared/ui/page-layout';
import { KpiCard } from '../../shared/ui/kpi-card';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { StatusBadge } from '../../shared/ui/status-badge';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { formatDateTime } from '../../shared/format/format-date';
import { useDuplicatePositionsQuery } from '../../features/inventory/hooks/use-duplicate-positions-query';
import { useProvenanceBackfillStatusQuery } from '../../features/inventory/hooks/use-provenance-backfill-status-query';
import type { DuplicatePositionGroup } from '../../features/inventory/api/inventory.types';
import {
  buildDuplicatePositionsCsv,
  triggerDuplicatePositionsCsvDownload,
} from '../../features/inventory/lib/duplicate-positions-csv';
import {
  findSurvivorId,
  liveExposureQuantity,
  reservationRiskRows,
} from '../../features/inventory/lib/duplicate-positions-remediation';
import { DuplicatePositionsRemediationModal } from './duplicate-positions-remediation-modal';

const DEFAULT_MAX_GROUPS = 100;
const MAX_GROUPS_CEILING = 500;

function IdCell({ value }: { value: string | null }): ReactElement {
  if (value === null) {
    return <span className="duplicate-positions-muted">—</span>;
  }
  return <span className="mono-text">{value}</span>;
}

/**
 * `productName`/`sku` (#3239) are `null` only when the product could not be
 * resolved (e.g. deleted) — raw id is the honest fallback, never a fabricated
 * name. The raw id is kept visible even when a name resolves, so an operator
 * can still find the row by id (e.g. quoting it in a support ticket).
 */
function ProductCell({ group }: { group: DuplicatePositionGroup }): ReactElement {
  if (group.productName === null) {
    return <span className="mono-text">{group.productId}</span>;
  }
  return (
    <span className="duplicate-positions-product-cell">
      <span>{group.productName}</span>
      <span className="mono-text duplicate-positions-muted duplicate-positions-product-cell__sku">
        <span>{group.sku ?? group.productId}</span>
        {group.sku !== null ? <span> · {group.productId}</span> : null}
      </span>
    </span>
  );
}

/**
 * ADR-058 decision 2 — `locationId === null` permanently means "the master
 * declines to locate its stock", a real fact rather than missing data. A
 * resolved id with no `locationName` (#3239) falls back to the raw id rather
 * than fabricating a name.
 */
function LocationCell({ id, name }: { id: string | null; name: string | null }): ReactElement {
  if (id === null) {
    return (
      <span
        className="duplicate-positions-provenance-flag"
        title="Master does not report a location for this stock (ADR-058 decision 2). Not missing data — treat as a real 'unlocated' value."
      >
        — unlocated —
      </span>
    );
  }
  return name !== null ? <span>{name}</span> : <span className="mono-text">{id}</span>;
}

/**
 * `null` and the #2317 `'legacy'` sentinel are ONE class — rows the
 * provenance backfill has not (null) or has just (legacy) touched — but they
 * render DISTINCT labels so an operator can tell "never seen" apart from
 * "the backfill's own placeholder", even though neither is ever resolved to
 * a `connectionName` (#3239).
 */
function ConnectionCell({ id, name }: { id: string | null; name: string | null }): ReactElement {
  if (id === null) {
    return (
      <span
        className="duplicate-positions-provenance-flag"
        title="No source connection recorded yet — this row predates the provenance backfill. Grouped together with 'legacy' rows; both mean the same thing."
      >
        — not backfilled —
      </span>
    );
  }
  if (id === 'legacy') {
    return (
      <span
        className="duplicate-positions-provenance-flag"
        title="Sentinel the provenance backfill writes for a row whose owning connection is unknown. Grouped together with unbackfilled rows — both mean the same thing."
      >
        legacy
      </span>
    );
  }
  return name !== null ? <span>{name}</span> : <span className="mono-text">{id}</span>;
}

function buildGroupColumns(): DataTableColumn<DuplicatePositionGroup>[] {
  return [
    {
      id: 'productId',
      header: 'Product',
      cell: (g) => <ProductCell group={g} />,
    },
    {
      id: 'productVariantId',
      header: 'Variant',
      cell: (g) => <IdCell value={g.productVariantId} />,
      hideBelow: 1024,
    },
    {
      id: 'locationId',
      header: 'Location',
      cell: (g) => <LocationCell id={g.locationId} name={g.locationName} />,
      hideBelow: 768,
    },
    {
      id: 'sourceConnectionId',
      header: 'Source connection',
      cell: (g) => <ConnectionCell id={g.sourceConnectionId} name={g.connectionName} />,
      hideBelow: 768,
    },
    {
      id: 'rowCount',
      header: 'Rows',
      accessor: (g) => g.rowCount,
      cell: (g) => <span className="mono-text tabular">{g.rowCount}</span>,
      sortable: true,
    },
    {
      id: 'liveExposureQuantity',
      header: 'Live qty at risk',
      accessor: (g) => liveExposureQuantity(g),
      cell: (g): ReactElement => {
        const exposure = liveExposureQuantity(g);
        return (
          <span
            className="mono-text tabular"
            title="Sum of availableQuantity across this group's LIVE (non-stale) rows — what's currently over-counted for this position."
          >
            {exposure > 0 ? exposure.toLocaleString('en-US') : '—'}
          </span>
        );
      },
      sortable: true,
    },
    {
      id: 'liveRowCount',
      header: 'Live rows',
      accessor: (g) => g.liveRowCount,
      cell: (g) =>
        g.liveRowCount > 0 ? (
          <StatusBadge tone="warning" withDot compact>
            {g.liveRowCount} live
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral" withDot compact>
            all stale
          </StatusBadge>
        ),
      sortable: true,
    },
  ];
}

function GroupRowDetail({
  group,
  onOpenRemediation,
}: {
  group: DuplicatePositionGroup;
  onOpenRemediation: (group: DuplicatePositionGroup) => void;
}): ReactElement {
  const survivorId = findSurvivorId(group);
  const exposure = liveExposureQuantity(group);
  const riskyRows = reservationRiskRows(group, survivorId);
  const oldest = group.rows[group.rows.length - 1];

  return (
    <div className="duplicate-positions-detail">
      {oldest ? (
        <p className="duplicate-positions-detail__hint">
          Default survivor rule: newest live row (marked below), colliding since{' '}
          {formatDateTime(oldest.updatedAt)}.
          {survivorId === null ? ' No live row in this group — see step 2 of the remediation guide.' : ''}
        </p>
      ) : null}

      {group.liveRowCount > 0 ? (
        <Alert tone="info">
          <strong>Currently distorting available-to-promise.</strong> This position&rsquo;s live
          rows sum to <strong>{exposure.toLocaleString('en-US')}</strong> available — the
          availability read has no way to know only one row is real, so it publishes{' '}
          {exposure.toLocaleString('en-US')} where the true figure is whichever row survives.
          Never sum the duplicated quantities when reconciling; re-read the survivor&rsquo;s figure
          from the master after cleanup.
        </Alert>
      ) : (
        <p className="duplicate-positions-detail__neutral-note">
          <strong>No live rows — no oversell risk today.</strong> Every
          row here is already stale, so the normal availability read already excludes this
          position. This group only blocks the stricter uniqueness migration; it is not an
          active stock-accuracy problem.
        </p>
      )}

      {riskyRows.length > 0 ? (
        <Alert tone="error">
          <strong>Reservation risk — do not blindly follow the survivor badge.</strong>{' '}
          {riskyRows
            .map((r) => `${r.id} holds ${r.reservedQuantity} reserved unit${r.reservedQuantity === 1 ? '' : 's'}`)
            .join(', ')}
          , but the default survivor rule picks the newest row regardless of reservations. Confirm
          no open order depends on this stock before deleting it — check Orders for this variant
          first.
        </Alert>
      ) : null}

      <div className="duplicate-positions-detail__table-scroll">
        <table className="data-table__detail-table">
          <caption className="sr-only">Individual inventory_items rows for this position key</caption>
          <thead>
            <tr>
              <th scope="col">Row ID</th>
              <th scope="col">Available</th>
              <th scope="col">Reserved</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.id} className={row.isStale ? 'data-table__detail-row--stale' : undefined}>
                <td>
                  <span className="mono-text duplicate-positions-detail__row-id">{row.id}</span>
                  {row.id === survivorId ? (
                    <span className="duplicate-positions-survivor-badge">✓ likely survivor</span>
                  ) : null}
                  {row.id !== survivorId && row.reservedQuantity > 0 ? (
                    <span className="duplicate-positions-reserved-badge">⛔ reserved</span>
                  ) : null}
                </td>
                <td className="tabular">{row.availableQuantity}</td>
                <td className="tabular">{row.reservedQuantity}</td>
                <td>
                  {row.isStale ? (
                    <StatusBadge tone="neutral" withDot>
                      Stale
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="success" withDot>
                      Live
                    </StatusBadge>
                  )}
                </td>
                <td title={row.updatedAt}>{formatDateTime(row.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="duplicate-positions-detail__remediation-link">
        <Button tone="ghost" className="button--sm" onClick={() => onOpenRemediation(group)}>
          Remediation guide: how to pick the survivor and delete the rest →
        </Button>
      </p>
    </div>
  );
}

export function DuplicatePositionsPage(): ReactElement {
  const [maxGroups, setMaxGroups] = useState<number>(DEFAULT_MAX_GROUPS);
  const [maxGroupsInput, setMaxGroupsInput] = useState<string>(String(DEFAULT_MAX_GROUPS));
  const [remediationGroup, setRemediationGroup] = useState<DuplicatePositionGroup | null>(null);
  const [remediationOpen, setRemediationOpen] = useState(false);

  const duplicatesQuery = useDuplicatePositionsQuery(maxGroups);
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

  // Ranked by live-stock exposure, not row count (see liveExposureQuantity's
  // docblock) — this is the DEFAULT render order; DataTable's own client
  // sort still lets an operator re-sort by any other sortable column.
  const rankedGroups = useMemo(() => {
    if (!report) return [];
    return [...report.groups].sort((a, b) => liveExposureQuantity(b) - liveExposureQuantity(a));
  }, [report]);

  const groupColumns = useMemo(() => buildGroupColumns(), []);

  const openRemediation = (group: DuplicatePositionGroup | null): void => {
    setRemediationGroup(group);
    setRemediationOpen(true);
  };

  const handleExportCsv = (): void => {
    if (!report) return;
    const csv = buildDuplicatePositionsCsv(report.groups);
    const timestamp = new Date().toISOString().slice(0, 10);
    triggerDuplicatePositionsCsvDownload(csv, `duplicate-positions-${timestamp}.csv`);
  };

  const applyMaxGroups = (): void => {
    const parsed = Number(maxGroupsInput);
    const clamped = Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_GROUPS_CEILING, parsed)) : DEFAULT_MAX_GROUPS;
    setMaxGroupsInput(String(clamped));
    setMaxGroups(clamped);
  };

  return (
    <PageLayout
      eyebrow="Diagnostics"
      title="Duplicate stock positions"
      description={
        'Stock rows that collide on the same product, variant, location and source. ' +
        'This is a report, not a repair tool — it detects, it never writes. ' +
        "It's the gate before a stricter uniqueness rule can be turned on for the whole install."
      }
      summary={
        report ? (
          <div className="duplicate-positions-meta-row">
            <span className="duplicate-positions-meta-row__timestamp">
              Generated {formatDateTime(report.generatedAt)}
            </span>
            <p className="duplicate-positions-meta-row__caution">
              Positions can change between this scan and a manual fix performed elsewhere — re-run
              the report immediately before acting on it, never from a page you loaded a while ago.
            </p>
          </div>
        ) : undefined
      }
      actions={
        <>
          <Button tone="secondary" className="button--sm" onClick={handleExportCsv} disabled={!report}>
            Export CSV
          </Button>
          <Button tone="secondary" className="button--sm" onClick={retry} disabled={isLoading}>
            Refresh
          </Button>
        </>
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
                    ? 'Provenance backfill complete'
                    : `Provenance backfill still running (${String(provenance.remainingNull)} row(s) remaining)`}
                </span>
              </li>
            </ul>
            {!noDuplicateGroups ? (
              <p className="duplicate-positions-checklist__footnote">
                Provenance is part of the key — two rows differing only by source connection are
                legitimate coexisting mirrors, not duplicates, and are already excluded from this
                count.
              </p>
            ) : null}
            {!isReady ? (
              <p className="duplicate-positions-checklist__footnote">
                Both conditions must hold before the stricter uniqueness index can be built. See
                docs/operations/inventory-duplicate-positions.md for the remediation procedure.
              </p>
            ) : null}
            {!isReady ? (
              <Button tone="ghost" className="button--sm" onClick={() => openRemediation(null)}>
                Remediation guide: how to pick the survivor and delete the rest →
              </Button>
            ) : null}
          </Alert>

          {report.truncated ? (
            <Alert tone="info" title="Detail truncated">
              <p>
                Showing the {report.groups.length} highest-exposure group(s), ranked by live stock
                quantity currently at risk of overselling — not row count. Totals above cover every
                group in the table; this list is capped for readability only.
              </p>
              <div className="duplicate-positions-maxgroups-form">
                <label htmlFor="maxGroupsInput">maxGroups</label>
                <Input
                  id="maxGroupsInput"
                  type="number"
                  min={1}
                  max={MAX_GROUPS_CEILING}
                  value={maxGroupsInput}
                  onChange={(e) => setMaxGroupsInput(e.target.value)}
                />
                <Button tone="secondary" className="button--sm" onClick={applyMaxGroups}>
                  Apply
                </Button>
              </div>
            </Alert>
          ) : null}

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
              description="inventory_items rows still missing sourceConnectionId."
            />
          </div>

          {rankedGroups.length === 0 ? (
            <EmptyState
              liveRegion="off"
              title="No duplicate positions"
              message="Every inventory position key is unique. Nothing to review."
            />
          ) : (
            <DataTable
              caption="Duplicate inventory positions"
              columns={groupColumns}
              rows={rankedGroups}
              rowKey={(g) =>
                `${g.productId}:${g.productVariantId ?? ''}:${g.locationId ?? ''}:${g.sourceConnectionId ?? ''}`
              }
              expandable={{
                renderDetail: (g) => <GroupRowDetail group={g} onOpenRemediation={openRemediation} />,
                toggleLabel: (g, expanded) =>
                  expanded
                    ? `Collapse rows for product ${g.productName ?? g.productId}`
                    : `Expand rows for product ${g.productName ?? g.productId}`,
              }}
              cardView={{
                title: (g) => g.productName ?? g.productId,
                subtitle: (g) => g.sku ?? g.productVariantId ?? undefined,
                meta: (g) => `${g.rowCount} rows (${g.liveRowCount} live)`,
                collapsibleDetail: true,
                detail: (g) => <GroupRowDetail group={g} onOpenRemediation={openRemediation} />,
              }}
            />
          )}
        </>
      ) : null}

      <DuplicatePositionsRemediationModal
        open={remediationOpen}
        onOpenChange={setRemediationOpen}
        group={remediationGroup}
      />
    </PageLayout>
  );
}
