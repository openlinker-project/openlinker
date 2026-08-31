/**
 * Analytics Data Coverage Panel
 *
 * The "Data coverage" `.attention-list` section (#2474, Phase 7) — one row
 * per `GET /analytics/coverage` category (currency, tax A/B/C,
 * product-matching), each opening its own detail modal with real pagination.
 * Mirrors `AnalyticsNeedsAttention`'s shape verbatim per the issue's own
 * instruction ("do not invent a new list pattern"): either the all-clear
 * line or the open rows, never both.
 *
 * Currency is the one category with a genuine async remediation
 * (#2468) — its row alone carries live `open` / `in-progress` / `failed` /
 * `resolved` sub-states, driven by polling the real
 * `analytics_remediation_runs.status` (never a client-only timer, per the
 * mini-epic AC). A resolved run dwells on a "Fixed — closing…" sub-state for
 * a beat before the row disappears, and opens a dismissible, green,
 * inline `.coverage-alert` — never a toast (also an explicit AC).
 *
 * Tax category A's "Include anyway" opens the shared `AnalyticsSettingsDialog`
 * rather than re-implementing its own confirm flow: that dialog already owns
 * the `includeBackfilledTaxRatesInNetSales` write path (#2471), access-gated
 * and demo-mode-aware — a second write surface here would duplicate it.
 * Category C's "Sync the catalog now" is a real action
 * (`POST .../tax/rerun-backfill`, #2469) scoped to the orders on the
 * currently-open page, stated honestly in its own button label.
 *
 * @module apps/web/src/features/analytics/components
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, LoadingState, StatusBadge, TimeDisplay } from '../../../shared/ui';
import { useToast } from '../../../shared/ui/toast-provider';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { useConnectionsQuery } from '../../connections';
import { OrderIdentityCell } from '../../orders';
import { useAnalyticsCoverageQuery } from '../hooks/use-analytics-coverage-query';
import { useRecalculateCurrencyMutation } from '../hooks/use-recalculate-currency-mutation';
import { useCurrencyRemediationStatusQuery } from '../hooks/use-currency-remediation-status-query';
import { useCurrencyMismatchOrdersQuery } from '../hooks/use-currency-mismatch-orders-query';
import { useTaxCoverageOrdersQuery } from '../hooks/use-tax-coverage-orders-query';
import { useMatchingCoverageOrdersQuery } from '../hooks/use-matching-coverage-orders-query';
import { useRerunTaxBackfillMutation } from '../hooks/use-rerun-tax-backfill-mutation';
import { analyticsCoverageQueryKeys } from '../api/analytics-coverage.query-keys';
import { AnalyticsCoverageAlert } from './analytics-coverage-alert';
import { CoverageDetailDialog } from './coverage-detail-dialog';
import {
  COVERAGE_CATEGORY_ORDER,
  DATA_COVERAGE_CHECK_COUNT,
  deriveCoverageRowCopy,
  describeMatchingRecordStatus,
} from '../lib/data-coverage-copy.lib';
import type { AnalyticsCoverageFilters, CoverageCategory, CoverageCategoryRow } from '../api/analytics-coverage.types';
import type { CurrencyMismatchOrder } from '../api/analytics-remediation.types';
import type { TaxCoverageCategory, TaxCoverageOrder } from '../api/analytics-tax-coverage.types';
import type { ProductMatchingOrder } from '../api/analytics-matching-coverage.types';

const PAGE_SIZE = 10;

/** How long the "Fixed — closing…" sub-state stays visible before the row disappears. */
const RESOLVED_DWELL_MS = 2000;

interface AnalyticsDataCoveragePanelProps {
  filters: AnalyticsCoverageFilters;
  /** Opens the shared Analytics Settings dialog — used by the tax-A row's "Include anyway" action. */
  onOpenSettings: () => void;
}

function isTaxCategory(category: CoverageCategory): category is TaxCoverageCategory {
  return category === 'tax-a' || category === 'tax-b' || category === 'tax-c';
}

export function AnalyticsDataCoveragePanel({
  filters,
  onOpenSettings,
}: AnalyticsDataCoveragePanelProps): ReactElement {
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('analytics:write', demoMode);
  const queryClient = useQueryClient();
  const coverageQuery = useAnalyticsCoverageQuery(filters);
  const connectionsQuery = useConnectionsQuery();

  const connectionName = useMemo(() => {
    const byId = new Map((connectionsQuery.data ?? []).map((c) => [c.id, c.name]));
    return (connectionId: string): string => byId.get(connectionId) ?? connectionId;
  }, [connectionsQuery.data]);

  const [openCategory, setOpenCategory] = useState<CoverageCategory | null>(null);
  const [offset, setOffset] = useState(0);

  function openDetail(category: CoverageCategory): void {
    setOffset(0);
    setOpenCategory(category);
  }
  function closeDetail(open: boolean): void {
    if (!open) setOpenCategory(null);
  }

  // ── Currency: the one live async remediation ──────────────────────────
  const recalculate = useRecalculateCurrencyMutation();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [dwellingResolved, setDwellingResolved] = useState(false);
  const [alertRun, setAlertRun] = useState<{ affectedCount: number } | null>(null);
  const dwellTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runStatusQuery = useCurrencyRemediationStatusQuery(activeRunId);

  // Recovers the live sub-state after a page reload / re-navigation (#2475):
  // the coverage aggregate reports the SERVER's own knowledge of an
  // in-flight run, which may exist even though this component instance
  // never called `recalculate` itself. Only seeds when nothing is already
  // being tracked locally — a run this session already started (and may be
  // mid-dwell) must not be clobbered by a slightly-stale poll response.
  useEffect(() => {
    const serverRunId = coverageQuery.data?.categories.find((row) => row.category === 'currency')
      ?.activeRunId;
    if (serverRunId && !activeRunId) {
      setActiveRunId(serverRunId);
    }
  }, [coverageQuery.data, activeRunId]);

  useEffect(() => {
    const status = runStatusQuery.data?.status;
    if (!activeRunId || !status) return;
    if (status === 'resolved' && !dwellingResolved) {
      setDwellingResolved(true);
      void queryClient.invalidateQueries({ queryKey: analyticsCoverageQueryKeys.all });
      dwellTimeout.current = setTimeout(() => {
        setAlertRun({ affectedCount: runStatusQuery.data?.affectedCount ?? 0 });
        setActiveRunId(null);
        setDwellingResolved(false);
      }, RESOLVED_DWELL_MS);
    }
  }, [activeRunId, dwellingResolved, queryClient, runStatusQuery.data]);

  useEffect(
    () => () => {
      if (dwellTimeout.current) clearTimeout(dwellTimeout.current);
    },
    []
  );

  function handleRecalculate(): void {
    recalculate.mutate(filters, {
      onSuccess: (run) => {
        setActiveRunId(run.id);
        setOpenCategory(null);
      },
      onError: (error) => {
        showToast({ tone: 'error', description: error.message });
      },
    });
  }

  const currencyRunPhase: 'open' | 'in-progress' | 'resolved' | 'failed' = activeRunId
    ? dwellingResolved
      ? 'resolved'
      : runStatusQuery.data?.status === 'failed'
        ? 'failed'
        : 'in-progress'
    : 'open';

  // ── Detail queries, one per category, only the open one enabled ───────
  const currencyOrdersQuery = useCurrencyMismatchOrdersQuery(
    { ...filters, limit: PAGE_SIZE, offset },
    { enabled: openCategory === 'currency' }
  );
  const taxOrdersQuery = useTaxCoverageOrdersQuery(
    {
      category: isTaxCategory(openCategory ?? 'tax-a') ? (openCategory as TaxCoverageCategory) : 'tax-a',
      ...filters,
      limit: PAGE_SIZE,
      offset,
    },
    { enabled: openCategory !== null && isTaxCategory(openCategory) }
  );
  const matchingOrdersQuery = useMatchingCoverageOrdersQuery(
    { ...filters, limit: PAGE_SIZE, offset },
    { enabled: openCategory === 'product-matching' }
  );

  const rerunBackfill = useRerunTaxBackfillMutation();

  function handleSyncCatalog(items: TaxCoverageOrder[]): void {
    rerunBackfill.mutate(
      { internalOrderIds: items.map((item) => item.internalOrderId) },
      {
        onSuccess: (result) => {
          showToast({
            tone: 'success',
            title: 'Catalog sync ran',
            description: `${result.updated} of ${result.scanned} rate-less line(s) resolved.`,
          });
        },
        onError: (error) => {
          showToast({ tone: 'error', description: error.message });
        },
      }
    );
  }

  if (coverageQuery.isLoading) {
    return (
      <article className="panel panel--dense">
        <div className="panel__header">
          <h3 className="section-title">Data coverage</h3>
        </div>
        <LoadingState title="Checking data coverage" message="Looking at currency, tax rates, product matching…" />
      </article>
    );
  }

  if (coverageQuery.error) {
    return (
      <article className="panel panel--dense">
        <div className="panel__header">
          <h3 className="section-title">Data coverage</h3>
        </div>
        <ErrorState
          title="Unable to check data coverage"
          message={coverageQuery.error.message}
          action={
            <Button type="button" onClick={() => void coverageQuery.refetch()}>
              Retry
            </Button>
          }
        />
      </article>
    );
  }

  const categoriesByKey = new Map(
    (coverageQuery.data?.categories ?? []).map((row) => [row.category, row])
  );
  // Currency renders open ('open' server status) OR live-locally-tracked async
  // states — an in-flight/failed run must keep the row visible even after the
  // server-side count would otherwise have dropped to zero mid-repair.
  const openRows: CoverageCategoryRow[] = COVERAGE_CATEGORY_ORDER.map((category) => categoriesByKey.get(category))
    .filter((row): row is CoverageCategoryRow => row !== undefined)
    .filter(
      (row) =>
        row.affectedCount > 0 ||
        row.status === 'in-progress' ||
        (row.category === 'currency' && activeRunId !== null)
    );

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <h3 className="section-title">Data coverage</h3>
      </div>

      {alertRun && (
        <AnalyticsCoverageAlert affectedCount={alertRun.affectedCount} onDismiss={() => setAlertRun(null)} />
      )}

      <ul className="attention-list">
        {openRows.length === 0 ? (
          <li className="attention-list__item attention-list__item--resolved">
            <StatusBadge tone="success" withDot>
              Clear
            </StatusBadge>
            <div className="attention-list__body">
              <span className="attention-list__headline">Nothing to do</span>
              <span className="attention-list__sub">
                {DATA_COVERAGE_CHECK_COUNT} checks · currency, tax rates, product matching
              </span>
            </div>
          </li>
        ) : (
          openRows.map((row) => (
            <DataCoverageRow
              key={row.category}
              row={row}
              currencyPhase={row.category === 'currency' ? currencyRunPhase : null}
              currencyFailedDetail={row.category === 'currency' ? (runStatusQuery.data?.detail ?? null) : null}
              onOpenDetail={() => openDetail(row.category)}
            />
          ))
        )}
      </ul>

      <CoverageDetailDialog<CurrencyMismatchOrder>
        open={openCategory === 'currency'}
        onOpenChange={closeDetail}
        title={deriveCoverageRowCopy(categoriesByKey.get('currency') ?? emptyRow('currency')).modalTitle}
        description={deriveCoverageRowCopy(categoriesByKey.get('currency') ?? emptyRow('currency')).modalDescription}
        isLoading={currencyOrdersQuery.isLoading}
        error={currencyOrdersQuery.error}
        onRetry={() => void currencyOrdersQuery.refetch()}
        items={currencyOrdersQuery.data?.items ?? []}
        total={currencyOrdersQuery.data?.total ?? 0}
        limit={PAGE_SIZE}
        offset={offset}
        onOffsetChange={setOffset}
        rowKey={(item) => item.internalOrderId}
        renderRow={(item) => (
          <CurrencyOrderRow item={item} connectionName={connectionName(item.sourceConnectionId)} />
        )}
        footerAction={
          write.visible ? (
            <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
              <Button
                type="button"
                disabled={recalculate.isPending || write.demoReadOnly}
                onClick={handleRecalculate}
              >
                {recalculate.isPending
                  ? 'Starting…'
                  : `Recalculate all ${currencyOrdersQuery.data?.total ?? 0} now`}
              </Button>
            </ReadOnlyLock>
          ) : undefined
        }
      />

      {isTaxCategory(openCategory ?? 'tax-a') && openCategory !== null && (
        <CoverageDetailDialog<TaxCoverageOrder>
          open
          onOpenChange={closeDetail}
          title={deriveCoverageRowCopy(categoriesByKey.get(openCategory) ?? emptyRow(openCategory)).modalTitle}
          description={
            deriveCoverageRowCopy(categoriesByKey.get(openCategory) ?? emptyRow(openCategory)).modalDescription
          }
          isLoading={taxOrdersQuery.isLoading}
          error={taxOrdersQuery.error}
          onRetry={() => void taxOrdersQuery.refetch()}
          items={taxOrdersQuery.data?.items ?? []}
          total={taxOrdersQuery.data?.total ?? 0}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          rowKey={(item) => item.internalOrderId}
          renderRow={(item) => (
            <TaxOrderRow item={item} connectionName={connectionName(item.sourceConnectionId)} />
          )}
          footerAction={
            openCategory === 'tax-a' ? (
              <Button
                type="button"
                tone="secondary"
                onClick={() => {
                  setOpenCategory(null);
                  onOpenSettings();
                }}
              >
                Turn on this setting ›
              </Button>
            ) : openCategory === 'tax-c' && write.visible ? (
              <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                <Button
                  type="button"
                  disabled={
                    rerunBackfill.isPending ||
                    write.demoReadOnly ||
                    (taxOrdersQuery.data?.items.length ?? 0) === 0
                  }
                  onClick={() => handleSyncCatalog(taxOrdersQuery.data?.items ?? [])}
                >
                  {rerunBackfill.isPending
                    ? 'Syncing…'
                    : `Sync the catalog for these ${taxOrdersQuery.data?.items.length ?? 0} now`}
                </Button>
              </ReadOnlyLock>
            ) : undefined
          }
        />
      )}

      <CoverageDetailDialog<ProductMatchingOrder>
        open={openCategory === 'product-matching'}
        onOpenChange={closeDetail}
        title={
          deriveCoverageRowCopy(categoriesByKey.get('product-matching') ?? emptyRow('product-matching')).modalTitle
        }
        description={
          deriveCoverageRowCopy(categoriesByKey.get('product-matching') ?? emptyRow('product-matching'))
            .modalDescription
        }
        isLoading={matchingOrdersQuery.isLoading}
        error={matchingOrdersQuery.error}
        onRetry={() => void matchingOrdersQuery.refetch()}
        items={matchingOrdersQuery.data?.items ?? []}
        total={matchingOrdersQuery.data?.total ?? 0}
        limit={PAGE_SIZE}
        offset={offset}
        onOffsetChange={setOffset}
        rowKey={(item) => item.internalOrderId}
        renderRow={(item) => (
          <MatchingOrderRow item={item} connectionName={connectionName(item.sourceConnectionId)} />
        )}
      />
    </article>
  );
}

function emptyRow(category: CoverageCategory): CoverageCategoryRow {
  return { category, status: 'open', affectedCount: 0, sampleOrderIds: [] };
}

interface DataCoverageRowProps {
  row: CoverageCategoryRow;
  currencyPhase: 'open' | 'in-progress' | 'resolved' | 'failed' | null;
  currencyFailedDetail: string | null;
  onOpenDetail: () => void;
}

function DataCoverageRow({ row, currencyPhase, currencyFailedDetail, onOpenDetail }: DataCoverageRowProps): ReactElement {
  const copy = deriveCoverageRowCopy(row);

  let badgeTone = copy.tone;
  let badgeLabel = copy.badgeLabel;
  let sub = copy.sub;
  let actionLabel = copy.actionLabel;

  if (currencyPhase === 'in-progress') {
    badgeTone = 'info';
    badgeLabel = 'In progress';
    sub = 'Recalculating in the background — this can take a minute. Safe to navigate away.';
    actionLabel = 'Recalculating…';
  } else if (currencyPhase === 'resolved') {
    badgeTone = 'success';
    badgeLabel = 'Fixed';
    sub = 'Recalculated and saved — closing…';
    actionLabel = 'Fixed';
  } else if (currencyPhase === 'failed') {
    badgeTone = 'error';
    badgeLabel = 'Failed';
    sub = currencyFailedDetail ?? 'The recalculation could not complete — see Jobs & Logs for detail.';
    actionLabel = 'Try again';
  }

  return (
    <li className="attention-list__item" style={{ padding: 0 }}>
      <button type="button" className="row-trigger" onClick={onOpenDetail}>
        <StatusBadge tone={badgeTone} withDot pulse={currencyPhase === 'in-progress'}>
          {badgeLabel}
        </StatusBadge>
        <span className="attention-list__body">
          <span className="attention-list__headline">{copy.headline}</span>
          <span className="attention-list__sub">{sub}</span>
        </span>
        <span className="button button--secondary button--sm attention-list__action">{actionLabel}</span>
      </button>
    </li>
  );
}

function CurrencyOrderRow({
  item,
  connectionName,
}: {
  item: CurrencyMismatchOrder;
  connectionName: string;
}): ReactElement {
  return (
    <>
      <span className="coverage-detail-row__body">
        <OrderIdentityCell orderId={item.internalOrderId} />
        <span className="coverage-detail-row__meta text-muted">
          {connectionName}
          {item.stampedAt ? (
            <>
              {' · '}
              <TimeDisplay iso={item.stampedAt} format="date" />
            </>
          ) : null}
        </span>
      </span>
      <span className="coverage-detail-row__trail">
        <span className="coverage-detail-row__tag">{item.stampedCurrency ?? 'not yet stamped'} · old</span>
      </span>
    </>
  );
}

function TaxOrderRow({ item, connectionName }: { item: TaxCoverageOrder; connectionName: string }): ReactElement {
  return (
    <>
      <span className="coverage-detail-row__body">
        <OrderIdentityCell orderId={item.internalOrderId} />
        <span className="coverage-detail-row__meta text-muted">
          {connectionName}
          {item.placedAt ? (
            <>
              {' · '}
              <TimeDisplay iso={item.placedAt} format="date" />
            </>
          ) : null}
        </span>
      </span>
    </>
  );
}

function MatchingOrderRow({
  item,
  connectionName,
}: {
  item: ProductMatchingOrder;
  connectionName: string;
}): ReactElement {
  return (
    <>
      <span className="coverage-detail-row__body">
        <OrderIdentityCell orderId={item.internalOrderId} />
        <span className="coverage-detail-row__meta text-muted">
          {connectionName}
          {item.mappingFailureReason ? ` · ${item.mappingFailureReason}` : ''}
        </span>
      </span>
      <span className="coverage-detail-row__trail">
        <span className="coverage-detail-row__tag coverage-detail-row__tag--neutral">
          {describeMatchingRecordStatus(item.recordStatus)}
        </span>
      </span>
    </>
  );
}
