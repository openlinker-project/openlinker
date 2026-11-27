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
 * The backing endpoints are `@Roles('admin')`-gated server-side, and the
 * page gates itself the same way — rendering an access-denied state for a
 * non-admin session rather than relying on a sibling PR's nav gate, which
 * covers only the nav affordance and not a direct navigation to this route
 * (`docs/frontend-architecture.md` § Access Control And UI Visibility).
 *
 * @module apps/web/src/pages/inventory
 */
import { useEffect, useId, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { KpiCard } from '../../shared/ui/kpi-card';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { StatusBadge } from '../../shared/ui/status-badge';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../shared/ui/tooltip';
import {
  interpolate,
  renderRich,
  selectPluralForm,
  useActiveLocale,
  useFormat,
  useMessages,
  usePlural,
  type Formatters,
} from '../../shared/i18n';
import { useSession } from '../../shared/auth/use-session';
import { useIsAdmin } from '../../shared/auth/use-permission';
import { useDuplicatePositionsQuery } from '../../features/inventory/hooks/use-duplicate-positions-query';
import { useProvenanceBackfillStatusQuery } from '../../features/inventory/hooks/use-provenance-backfill-status-query';
import type { DuplicatePositionGroup } from '../../features/inventory/api/inventory.types';
import {
  buildDuplicatePositionsCsv,
  triggerDuplicatePositionsCsvDownload,
} from '../../features/inventory/lib/duplicate-positions-csv';
import {
  atRiskExposureQuantity,
  findSurvivorId,
  hasOversellRisk,
  liveExposureQuantity,
  reservationRiskRows,
} from '../../features/inventory/lib/duplicate-positions-remediation';
import { DuplicatePositionsRemediationModal } from './duplicate-positions-remediation-modal';
import { describeApiError } from '../../shared/api/describe-api-error';

/**
 * Mirrors `DEFAULT_DUPLICATE_POSITION_GROUPS` / `MAX_DUPLICATE_POSITION_GROUPS`
 * from `libs/core/src/inventory/application/services/inventory-query.service.ts`
 * (re-exported by the backend as `INVENTORY_DUPLICATE_POSITIONS_MAX_GROUPS`,
 * `apps/api/src/inventory/http/dto/get-duplicate-positions-query.dto.ts`, for
 * exactly this purpose). `apps/web` can't import `@openlinker/core` (#591)
 * and there's no generated client for this endpoint, so this is a plain
 * duplicated literal — the server's `@Max`/`@Min` on `GetDuplicatePositionsQueryDto`
 * is the real backstop; this ceiling only shapes the operator-facing input.
 * If either backend value ever changes, update both here.
 */
const DEFAULT_MAX_GROUPS = 100;
const MAX_GROUPS_CEILING = 500;

type PageCopy = ReturnType<typeof useMessages<'inventory'>>['duplicatePositionsPage'];

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
  const copy = useMessages('inventory').duplicatePositionsPage;
  if (id === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="duplicate-positions-provenance-flag" tabIndex={0}>
            {copy.unlocated}
          </span>
        </TooltipTrigger>
        <TooltipContent>{copy.unlocatedTip}</TooltipContent>
      </Tooltip>
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
  const copy = useMessages('inventory').duplicatePositionsPage;
  if (id === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="duplicate-positions-provenance-flag" tabIndex={0}>
            {copy.notBackfilled}
          </span>
        </TooltipTrigger>
        <TooltipContent>{copy.notBackfilledTip}</TooltipContent>
      </Tooltip>
    );
  }
  if (id === 'legacy') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="duplicate-positions-provenance-flag" tabIndex={0}>
            {copy.legacy}
          </span>
        </TooltipTrigger>
        <TooltipContent>{copy.legacyTip}</TooltipContent>
      </Tooltip>
    );
  }
  return name !== null ? <span>{name}</span> : <span className="mono-text">{id}</span>;
}

function buildGroupColumns(page: PageCopy, format: Formatters): DataTableColumn<DuplicatePositionGroup>[] {
  const copy = page.columns;
  return [
    {
      id: 'productId',
      header: copy.product,
      cell: (g) => <ProductCell group={g} />,
    },
    {
      id: 'productVariantId',
      header: copy.variant,
      cell: (g) => <IdCell value={g.productVariantId} />,
      hideBelow: 1024,
    },
    {
      id: 'locationId',
      header: copy.location,
      cell: (g) => <LocationCell id={g.locationId} name={g.locationName} />,
      hideBelow: 768,
    },
    {
      id: 'sourceConnectionId',
      header: copy.sourceConnection,
      cell: (g) => <ConnectionCell id={g.sourceConnectionId} name={g.connectionName} />,
      hideBelow: 768,
    },
    {
      id: 'rowCount',
      header: (
        <span title={copy.sortHint}>{copy.rows}</span>
      ),
      accessor: (g) => g.rowCount,
      cell: (g) => <span className="mono-text tabular">{g.rowCount}</span>,
      sortable: true,
    },
    {
      id: 'liveExposureQuantity',
      header: (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{copy.liveQty}</span>
          </TooltipTrigger>
          <TooltipContent>{copy.liveQtyTip}</TooltipContent>
        </Tooltip>
      ),
      accessor: (g) => atRiskExposureQuantity(g),
      cell: (g): ReactElement => {
        const exposure = atRiskExposureQuantity(g);
        return (
          <span className="mono-text tabular">
            {exposure > 0 ? format.number(exposure) : '—'}
          </span>
        );
      },
      sortable: true,
    },
    {
      id: 'liveRowCount',
      header: (
        <span title={copy.sortHint}>{copy.liveRows}</span>
      ),
      accessor: (g) => g.liveRowCount,
      cell: (g) =>
        hasOversellRisk(g) ? (
          <StatusBadge tone="warning" withDot compact>
            {interpolate(copy.nLive, { n: g.liveRowCount })}
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral" withDot compact>
            {g.liveRowCount === 1 ? copy.oneLive : copy.allStale}
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
  const page = useMessages('inventory').duplicatePositionsPage;
  const copy = page.detail;
  const format = useFormat();
  const plural = usePlural();
  const strong = { strong: (text: string) => <strong>{text}</strong> };
  const survivorId = findSurvivorId(group);
  const exposure = liveExposureQuantity(group);
  const riskyRows = reservationRiskRows(group, survivorId);
  const oldest = group.rows[group.rows.length - 1];

  return (
    <div className="duplicate-positions-detail">
      {oldest ? (
        <p className="duplicate-positions-detail__hint">
          {interpolate(copy.survivorHint, { date: format.dateTime(oldest.updatedAt) })}
          {survivorId === null ? ` ${copy.noLiveRow}` : ''}
        </p>
      ) : null}

      {hasOversellRisk(group) ? (
        <Alert tone="info">
          {renderRich(copy.distorting, strong, { n: format.number(exposure) })}
        </Alert>
      ) : (
        <p className="duplicate-positions-detail__neutral-note">
          {renderRich(group.liveRowCount === 1 ? copy.oneLive : copy.noLive, strong)}
        </p>
      )}

      {riskyRows.length > 0 ? (
        <Alert tone="error">
          <strong>{copy.reservationRiskTitle}</strong>{' '}
          {interpolate(copy.reservationRiskBody, {
            rows: riskyRows
              .map((r) => plural(r.reservedQuantity, copy.reservationRiskRow, { id: r.id }))
              .join(', '),
          })}
        </Alert>
      ) : null}

      {/* No cell in this table is focusable (spans and StatusBadges only), so
          without these attributes a keyboard-only user has no way to reach
          the overflowed columns on a narrow viewport — copied from the
          shared scrollable-container treatment `data-table.tsx` gives its
          own `plainScrollable` region (tech-review of #3255). */}
      <div
        className="duplicate-positions-detail-table__scroll"
        tabIndex={0}
        role="region"
        aria-label={copy.rowsRegion}
      >
        <table className="duplicate-positions-detail-table">
          <caption className="sr-only">{copy.rowsCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{copy.rowId}</th>
              <th scope="col">{copy.available}</th>
              <th scope="col">{copy.reserved}</th>
              <th scope="col">{copy.status}</th>
              <th scope="col">{copy.updated}</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr
                key={row.id}
                className={row.isStale ? 'duplicate-positions-detail-table__row--stale' : undefined}
              >
                <td>
                  <span className="mono-text duplicate-positions-detail__row-id">{row.id}</span>
                  {row.id === survivorId ? (
                    <span className="duplicate-positions-survivor-badge">
                      <span aria-hidden="true">✓</span> {copy.likelySurvivor}
                    </span>
                  ) : null}
                  {row.id !== survivorId && row.reservedQuantity > 0 ? (
                    <span className="duplicate-positions-reserved-badge">
                      <span aria-hidden="true">⛔</span> {copy.reservedBadge}
                    </span>
                  ) : null}
                </td>
                <td className="tabular">{row.availableQuantity}</td>
                <td className="tabular">{row.reservedQuantity}</td>
                <td>
                  {row.isStale ? (
                    <StatusBadge tone="neutral" withDot>
                      {copy.stale}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="success" withDot>
                      {copy.live}
                    </StatusBadge>
                  )}
                </td>
                <td title={row.updatedAt}>{format.dateTime(row.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="duplicate-positions-detail__remediation-link">
        <Button tone="ghost" className="button--sm" onClick={() => onOpenRemediation(group)}>
          {page.remediationLink}
        </Button>
      </p>
    </div>
  );
}

function clampMaxGroups(value: number): number {
  return Math.max(1, Math.min(MAX_GROUPS_CEILING, Math.trunc(value)));
}

export function DuplicatePositionsPage(): ReactElement {
  const copy = useMessages('inventory').duplicatePositionsPage;
  const format = useFormat();
  const plural = usePlural();
  const locale = useActiveLocale();
  const { isReady: isSessionReady } = useSession();
  const isAdmin = useIsAdmin();
  const maxGroupsInputId = useId();

  // `maxGroups` lives in the URL — it's pagination (docs/frontend-architecture.md
  // § URL State), and the page's own caution copy tells an operator to
  // re-run the report "immediately before acting on it", making a reload
  // the documented workflow; a component-state cap would silently reset to
  // the default on every one (#3264 review).
  const [searchParams, setSearchParams] = useSearchParams();
  const maxGroupsParam = searchParams.get('maxGroups');
  // `Number('')` is `0`, which is finite — so a present-but-empty
  // `?maxGroups=` clamped to `1` instead of falling back to the default
  // (#3264 review). Treat empty exactly like absent.
  const parsedMaxGroupsParam =
    maxGroupsParam === null || maxGroupsParam === '' ? NaN : Number(maxGroupsParam);
  const maxGroups = Number.isFinite(parsedMaxGroupsParam)
    ? clampMaxGroups(parsedMaxGroupsParam)
    : DEFAULT_MAX_GROUPS;
  const [maxGroupsInput, setMaxGroupsInput] = useState<string>(String(maxGroups));
  const [remediationGroup, setRemediationGroup] = useState<DuplicatePositionGroup | null>(null);
  const [remediationOpen, setRemediationOpen] = useState(false);

  // `maxGroups` is the URL-owned value; `maxGroupsInput` is a local draft so
  // typing doesn't re-fetch on every keystroke. Without this effect the
  // draft only ever tracks its own `applyMaxGroups` writes, so browser
  // back/forward or a pasted `?maxGroups=…` link changes what's fetched
  // without updating what the input displays (tech-review of #3264).
  useEffect(() => {
    setMaxGroupsInput(String(maxGroups));
  }, [maxGroups]);

  const duplicatesQuery = useDuplicatePositionsQuery(maxGroups);
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

  // Ranked by AT-RISK live-stock exposure, not row count and not the raw
  // exposure sum — a naive sort on the raw sum ranks a healthy
  // single-live-row group with a large quantity above a genuinely at-risk
  // two-live-row group with a small one (#3264 review). This is the
  // DEFAULT render order; DataTable's own client sort still lets an
  // operator re-sort by any other sortable column.
  const rankedGroups = useMemo(() => {
    if (!report) return [];
    return [...report.groups].sort((a, b) => atRiskExposureQuantity(b) - atRiskExposureQuantity(a));
  }, [report]);

  const groupColumns = useMemo(() => buildGroupColumns(copy, format), [copy, format]);

  const openRemediation = (group: DuplicatePositionGroup | null): void => {
    setRemediationGroup(group);
    setRemediationOpen(true);
  };

  const handleExportCsv = (): void => {
    if (!report) return;
    const csv = buildDuplicatePositionsCsv(report.groups);
    // Named from the REPORT's own scan instant, not the moment of the click
    // — two exports of the same loaded report on either side of midnight
    // must get the same name, and an export of a stale page must not carry
    // today's date as if it were fresh (#3264 review). `truncated` is
    // encoded too: the csv module's own docblock requires the caller to
    // state explicitly that a truncated export is partial rather than let
    // it silently under-report.
    const datePart = report.generatedAt.slice(0, 10);
    const truncatedSuffix = report.truncated ? '-partial' : '';
    triggerDuplicatePositionsCsvDownload(csv, `duplicate-positions-${datePart}${truncatedSuffix}.csv`);
  };

  const applyMaxGroups = (): void => {
    // Same empty-string-is-not-zero fix as the URL-param read above — a
    // cleared input must fall back to the default, not clamp to 1.
    const parsed = maxGroupsInput === '' ? NaN : Number(maxGroupsInput);
    const clamped = Number.isFinite(parsed) ? clampMaxGroups(parsed) : DEFAULT_MAX_GROUPS;
    setMaxGroupsInput(String(clamped));
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (clamped === DEFAULT_MAX_GROUPS) {
        next.delete('maxGroups');
      } else {
        next.set('maxGroups', String(clamped));
      }
      return next;
    });
  };

  if (isSessionReady && !isAdmin) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title} description={copy.adminOnly}>
        <ErrorState title={copy.adminRequiredTitle} message={copy.adminRequiredMessage} />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      summary={
        report ? (
          <div className="duplicate-positions-meta-row">
            <span className="duplicate-positions-meta-row__timestamp">
              {interpolate(copy.generated, { date: format.dateTime(report.generatedAt) })}
            </span>
            <p className="duplicate-positions-meta-row__caution">{copy.caution}</p>
          </div>
        ) : undefined
      }
      actions={
        <>
          <Button tone="secondary" className="button--sm" onClick={handleExportCsv} disabled={!report}>
            {copy.exportCsv}
          </Button>
          <Button
            tone="secondary"
            className="button--sm"
            onClick={retry}
            disabled={isLoading || isFetching}
          >
            {isFetching ? copy.refreshing : copy.refresh}
          </Button>
        </>
      }
    >
      {!isSessionReady || isLoading ? (
        <LoadingState
          title={copy.loadingTitle}
          message={copy.loadingMessage}
        />
      ) : initialLoadError ? (
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(initialLoadError, 'inventory')}
          action={<Button onClick={retry}>{copy.retry}</Button>}
        />
      ) : report && provenance ? (
        <>
          {refreshError ? (
            <Alert tone="error" title={copy.refreshFailedTitle}>
              {interpolate(copy.refreshFailedBody, {
                error: describeApiError(refreshError, 'inventory'),
              })}
            </Alert>
          ) : null}
          <Alert tone={isReady ? 'success' : 'warning'} title={isReady ? copy.ready : copy.notReady}>
            <ul className="duplicate-positions-checklist">
              <li>
                <StatusBadge tone={noDuplicateGroups ? 'success' : 'error'} withDot>
                  {noDuplicateGroups ? copy.done : copy.pending}
                </StatusBadge>
                <span>
                  {noDuplicateGroups ? copy.noGroups : plural(report.groupCount, copy.groupsToResolve)}
                </span>
              </li>
              <li>
                <StatusBadge
                  tone={backfillComplete ? 'success' : provenanceLatchedAndStuck ? 'error' : 'warning'}
                  withDot
                >
                  {backfillComplete ? copy.done : provenanceLatchedAndStuck ? copy.stuck : copy.pending}
                </StatusBadge>
                <span>
                  {backfillComplete
                    ? copy.backfillComplete
                    : stuckSinceLatchedAt !== null
                      ? interpolate(copy.backfillStuck, {
                          n: provenance.remainingNull,
                          date: format.dateTime(stuckSinceLatchedAt),
                        })
                      : interpolate(copy.backfillRemaining, { n: provenance.remainingNull })}
                </span>
              </li>
            </ul>
            {!noDuplicateGroups ? (
              <p className="duplicate-positions-checklist__footnote">
                {copy.provenanceFootnote}
              </p>
            ) : null}
            {!isReady ? (
              <p className="duplicate-positions-checklist__footnote">
                {copy.notReadyFootnote}
              </p>
            ) : null}
            {!isReady ? (
              <Button tone="ghost" className="button--sm" onClick={() => openRemediation(null)}>
                {copy.remediationLink}
              </Button>
            ) : null}
          </Alert>

          <div className="ds-grid ds-grid--4">
            <KpiCard
              label={copy.kpis.groups}
              value={report.groupCount}
              tone={noDuplicateGroups ? 'success' : 'error'}
            />
            <KpiCard label={copy.kpis.totalRows} value={report.rowCount} tone="neutral" />
            <KpiCard
              label={copy.kpis.excessRows}
              value={report.excessRowCount}
              tone={report.excessRowCount === 0 ? 'success' : 'warning'}
              description={copy.kpis.excessRowsHint}
            />
            <KpiCard
              label={copy.kpis.provenanceRemaining}
              value={provenance.remainingNull}
              tone={backfillComplete ? 'success' : provenanceLatchedAndStuck ? 'error' : 'warning'}
              description={
                provenanceLatchedAndStuck
                  ? copy.kpis.provenanceStuckHint
                  : copy.kpis.provenanceHint
              }
            />
          </div>

          {report.truncated ? (
            <Alert tone="info" title={copy.truncated.title}>
              <p>
                {renderRich(
                  selectPluralForm(report.groupCount, copy.truncated.body, locale),
                  { code: (text: string) => <span className="mono-text">{text}</span> },
                  { shown: report.groups.length, n: report.groupCount },
                )}
              </p>
              <div className="duplicate-positions-maxgroups-form">
                <label htmlFor={maxGroupsInputId}>{copy.truncated.groupsToShow}</label>
                <Input
                  id={maxGroupsInputId}
                  type="number"
                  min={1}
                  max={MAX_GROUPS_CEILING}
                  value={maxGroupsInput}
                  onChange={(e) => setMaxGroupsInput(e.target.value)}
                />
                <Button tone="secondary" className="button--sm" onClick={applyMaxGroups}>
                  {copy.truncated.apply}
                </Button>
              </div>
            </Alert>
          ) : null}

          {rankedGroups.length === 0 ? (
            // Default `polite` (feedback-state.tsx) — this replaces the
            // LoadingState as a transition when the scan comes back clean,
            // so the all-clear should announce like the loading state that
            // preceded it, not go silent (#3255 review).
            <EmptyState
              title={copy.empty.title}
              message={copy.empty.message}
            />
          ) : (
            <DataTable
              caption={copy.caption}
              columns={groupColumns}
              rows={rankedGroups}
              rowKey={(g) =>
                JSON.stringify([g.productId, g.productVariantId, g.locationId, g.sourceConnectionId])
              }
              expandable={{
                renderDetail: (g) => <GroupRowDetail group={g} onOpenRemediation={openRemediation} />,
                toggleLabel: (g, expanded) =>
                  expanded
                    ? interpolate(copy.collapseRows, { product: g.productName ?? g.productId })
                    : interpolate(copy.expandRows, { product: g.productName ?? g.productId }),
              }}
              cardView={{
                title: (g) => g.productName ?? g.productId,
                subtitle: (g) => g.sku ?? g.productVariantId ?? undefined,
                meta: (g) => interpolate(copy.cardMeta, { rows: g.rowCount, live: g.liveRowCount }),
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
