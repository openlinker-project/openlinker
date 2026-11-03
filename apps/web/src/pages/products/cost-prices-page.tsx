/**
 * Cost prices work list (#3588, M30)
 *
 * Where an admin fills in the net unit cost of the variants that margin is
 * missing: what to fix first (by net sales in the last 30 days), inline entry
 * with Enter-to-next, and one cost for several variants at once. A missing cost
 * blocks nothing; it only leaves a line out of margin, so this page is a work
 * list and never an error surface.
 *
 * Cost counts from the NEXT order (D27), and the copy says so wherever a number
 * is shown. Bulk fill never overwrites an existing cost (the API fills only
 * where empty).
 *
 * State lives where the docs put it: tab, search, channel and offset in the URL,
 * server data in TanStack Query, the row being edited and the selection in
 * component state.
 *
 * @module apps/web/src/pages/products
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { BulkActionBar } from '../../shared/ui/bulk-action-bar';
import { CheckboxCell } from '../../shared/ui/checkbox-cell';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { StatusBadge } from '../../shared/ui/status-badge';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { ListPagination } from '../../shared/ui/list-pagination';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { Tabs, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../shared/ui/dialog';
import { useToast } from '../../shared/ui/toast-provider';
import { formatAmount } from '../../shared/format/format-amount';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { useConnectionsQuery } from '../../features/connections';
import { useTrackMargin } from '../../features/analytics';
import {
  useCostCoverageQuery,
  useCostSummaryQuery,
} from '../../features/products/hooks/use-cost-coverage-query';
import {
  useCostWorklistRowsQuery,
  useCostWorklistTotal,
} from '../../features/products/hooks/use-cost-worklist-query';
import {
  useBulkFillCostMutation,
  useSetWorklistCostMutation,
} from '../../features/products/hooks/use-set-worklist-cost-mutations';
import {
  COST_WORKLIST_TAB_VALUES,
  type CostWorklistRow,
  type CostWorklistTab,
} from '../../features/products/api/products.types';
import { formatCostAmount } from './variant-cost';

const PAGE_SIZE = 20;
const FALLBACK_CURRENCIES = ['PLN', 'EUR', 'CZK'] as const;
const COST_ERROR_COPY = 'Enter 0 or more, with up to 2 decimals.';
const READ_ONLY_DEMO_MESSAGE = 'This is a read-only demo, so cost prices cannot be changed.';

function isTab(value: string | null): value is CostWorklistTab {
  return (COST_WORKLIST_TAB_VALUES as readonly string[]).includes(value ?? '');
}

function rowSlug(row: CostWorklistRow): string {
  return (row.sku ?? row.variantId).toLowerCase();
}

function rowLabel(row: CostWorklistRow): string {
  const attrs = row.attributes ? Object.values(row.attributes).filter(Boolean).join(', ') : '';
  return attrs ? `${row.productName}, ${attrs}` : row.productName;
}

/** `"11,4"` -> `"11.4"`; `null` when it is not a valid net cost. */
export function parseCostInput(raw: string): string | null {
  const value = raw.trim().replace(',', '.');
  return /^\d{1,8}(\.\d{1,2})?$/.test(value) ? value : null;
}

interface CostKpiProps {
  testId: string;
  label: string;
  value: string;
  metric?: string;
  tone?: 'success' | 'warning';
}

function CostKpi({ testId, label, value, metric, tone }: CostKpiProps): ReactElement {
  return (
    <div className={`kpi-card${tone ? ` kpi-card--${tone}` : ''}`} data-testid={testId}>
      <div className="kpi-card__label">
        <span className="kpi-card__label-text">{label}</span>
      </div>
      <div className="kpi-card__headline">
        <div className="kpi-card__value mono-text tabular">{value}</div>
        {metric ? <div className="kpi-card__metric">{metric}</div> : null}
      </div>
    </div>
  );
}

function currencyOptions(reporting: string | undefined): string[] {
  return Array.from(
    new Set([reporting, ...FALLBACK_CURRENCIES].filter((code): code is string => Boolean(code)))
  );
}

interface SavedCost {
  amount: string;
  currency: string;
}

export function CostPricesPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('products:write', demoMode);
  const canEdit = write.canWrite;
  const trackMargin = useTrackMargin();

  // ── URL state ────────────────────────────────────────────────────────────
  const rawTab = searchParams.get('tab');
  const tab: CostWorklistTab = isTab(rawTab) ? rawTab : 'sold';
  const urlQuery = searchParams.get('q') ?? '';
  const channel = searchParams.get('channel') ?? '';
  const offset = Math.max(0, Number(searchParams.get('offset') ?? '0') || 0);

  const [searchInput, setSearchInput] = useState(urlQuery);
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  useEffect(() => {
    if (debouncedSearch.trim() === urlQuery) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debouncedSearch.trim()) next.set('q', debouncedSearch.trim());
        else next.delete('q');
        next.delete('offset');
        return next;
      },
      { replace: true }
    );
    // `urlQuery` is read, not a trigger: only a settled input should write the URL.
  }, [debouncedSearch]);

  function setParam(key: string, value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'offset') next.delete('offset');
      return next;
    });
  }

  const filters = useMemo(
    () => ({
      tab,
      ...(urlQuery ? { q: urlQuery } : {}),
      ...(channel ? { channel } : {}),
    }),
    [tab, urlQuery, channel]
  );

  // ── Server state ─────────────────────────────────────────────────────────
  const coverageQuery = useCostCoverageQuery();
  const summaryQuery = useCostSummaryQuery();
  const rowsQuery = useCostWorklistRowsQuery(filters, { limit: PAGE_SIZE, offset });
  const totalStage = useCostWorklistTotal(filters, rowsQuery.data);
  const connectionsQuery = useConnectionsQuery();
  const setCost = useSetWorklistCostMutation();
  const bulkFill = useBulkFillCostMutation();

  const coverage = coverageQuery.data;
  const summary = summaryQuery.data;
  const rows = useMemo(() => rowsQuery.data?.items ?? [], [rowsQuery.data]);
  const reportingCurrency = rowsQuery.data?.currency ?? coverage?.currency;
  const currencies = currencyOptions(reportingCurrency);

  // ── Local state ──────────────────────────────────────────────────────────
  // Rows the operator priced in this visit stay on screen as "saved" instead of
  // vanishing from the no-cost tab under their cursor.
  const [saved, setSaved] = useState<Record<string, SavedCost>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftCurrency, setDraftCurrency] = useState('');
  const [draftError, setDraftError] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState('');
  const [bulkCurrency, setBulkCurrency] = useState('');
  const [bulkError, setBulkError] = useState(false);
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  // A different page of results is a different selection and a different edit.
  useEffect(() => {
    setSelected(new Set());
    setEditingId(null);
  }, [tab, urlQuery, channel, offset]);

  useEffect(() => {
    if (!focusRowId) return;
    const row = rows.find((candidate) => candidate.variantId === focusRowId);
    if (row) {
      tableRef.current
        ?.querySelector<HTMLElement>(`[data-testid="cost-worklist-add-${rowSlug(row)}"]`)
        ?.focus();
    }
    setFocusRowId(null);
  }, [focusRowId, rows]);

  const needsCost = (row: CostWorklistRow): boolean =>
    row.netUnitCost === null && saved[row.variantId] === undefined;
  const selectable = rows.filter(needsCost);

  function startEdit(row: CostWorklistRow): void {
    setEditingId(row.variantId);
    setDraft('');
    setDraftError(false);
    setDraftCurrency(reportingCurrency ?? currencies[0] ?? 'PLN');
  }

  function saveRow(row: CostWorklistRow): void {
    const amount = parseCostInput(draft);
    if (amount === null) {
      setDraftError(true);
      return;
    }
    setCost.mutate(
      { variantId: row.variantId, input: { netUnitCost: amount, currency: draftCurrency } },
      {
        onSuccess: () => {
          setSaved((prev) => ({
            ...prev,
            [row.variantId]: { amount, currency: draftCurrency },
          }));
          setEditingId(null);
          const index = rows.findIndex((candidate) => candidate.variantId === row.variantId);
          const next = rows.slice(index + 1).find(needsCost);
          if (next) setFocusRowId(next.variantId);
        },
        onError: (error) => {
          showToast({ tone: 'error', description: error.message || 'The cost could not be saved.' });
        },
      }
    );
  }

  function toggleRow(variantId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }

  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.variantId));
  const someSelected = selectable.some((r) => selected.has(r.variantId));

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.variantId)));
  }

  const selectedRows = selectable.filter((r) => selected.has(r.variantId));

  function openBulk(): void {
    setBulkDraft('');
    setBulkError(false);
    setBulkCurrency(reportingCurrency ?? currencies[0] ?? 'PLN');
    setBulkOpen(true);
  }

  function saveBulk(): void {
    const amount = parseCostInput(bulkDraft);
    if (amount === null) {
      setBulkError(true);
      return;
    }
    bulkFill.mutate(
      {
        variantIds: selectedRows.map((r) => r.variantId),
        netUnitCost: amount,
        currency: bulkCurrency,
      },
      {
        onSuccess: (result) => {
          setSaved((prev) => {
            const next = { ...prev };
            for (const id of result.filled) next[id] = { amount, currency: bulkCurrency };
            return next;
          });
          const filled = result.filled.length;
          const skipped = result.skippedAlreadySet.length;
          showToast({
            tone: 'success',
            title: `Cost saved for ${String(filled)} ${filled === 1 ? 'variant' : 'variants'}`,
            description:
              skipped > 0
                ? `${String(skipped)} already had a cost and ${skipped === 1 ? 'was' : 'were'} left as it was.`
                : 'It counts toward margin from the next order.',
          });
          setBulkOpen(false);
          setSelected(new Set());
        },
        onError: (error) => {
          showToast({ tone: 'error', description: error.message || 'The costs could not be saved.' });
        },
      }
    );
  }

  // ── Derived display ──────────────────────────────────────────────────────
  const tabCount = (value: CostWorklistTab): number | null => {
    if (value === 'sold') return coverage?.soldVariantsWithoutCost ?? null;
    if (value === 'all') return summary?.variantsWithoutCost ?? null;
    return summary?.variantsWithCost ?? null;
  };
  const coveragePct = coverage?.coveragePct ?? null;
  const unfiltered = urlQuery === '' && channel === '';
  const soldDone =
    tab === 'sold' &&
    unfiltered &&
    rowsQuery.isSuccess &&
    rows.length === 0 &&
    coverage !== undefined &&
    coverage.soldVariantsWithoutCost === 0;
  const unsoldMissing =
    coverage && summary ? Math.max(0, summary.variantsWithoutCost - coverage.soldVariantsWithoutCost) : null;
  const showRunningShare = tab === 'sold' && offset === 0 && (coverage?.netSalesWithoutCost ?? 0) > 0;
  const showEditing = canEdit;
  const channels = (connectionsQuery.data ?? []).filter((c) => c.status === 'active');

  let cumulative = 0;

  function renderCostCell(row: CostWorklistRow): ReactElement {
    const slug = rowSlug(row);
    const savedCost = saved[row.variantId];
    if (savedCost) {
      return (
        <span className="cost-worklist__saved" data-testid={`cost-worklist-saved-${slug}`}>
          {savedCost.currency} {formatCostAmount(savedCost.amount)} net · saved, counts from the next
          order
        </span>
      );
    }
    if (row.netUnitCost !== null) {
      return (
        <span className="mono-text tabular" data-testid={`cost-worklist-cost-${slug}`}>
          {row.costCurrency ?? ''} {formatCostAmount(row.netUnitCost)}
        </span>
      );
    }
    if (!showEditing) {
      const badge = (
        <StatusBadge tone="warning" withDot compact>
          Not recorded
        </StatusBadge>
      );
      return (
        <span data-testid={`cost-worklist-cost-${slug}`}>
          {write.demoReadOnly ? (
            <ReadOnlyLock active message={READ_ONLY_DEMO_MESSAGE}>
              <Button type="button" tone="secondary" className="button--sm" disabled>
                Add cost
              </Button>
            </ReadOnlyLock>
          ) : (
            badge
          )}
        </span>
      );
    }
    if (editingId === row.variantId) {
      return (
        <form
          className="cost-worklist__inline"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            saveRow(row);
          }}
        >
          <div className={`field__price-input${draftError ? ' has-error' : ''}`}>
            <Input
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={draft}
              aria-label={`Net cost for ${row.sku ?? rowLabel(row)}`}
              aria-invalid={draftError ? true : undefined}
              data-testid={`cost-worklist-input-${slug}`}
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftError(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditingId(null);
              }}
            />
            <span className="field__currency">net</span>
          </div>
          <Select
            aria-label="Currency"
            value={draftCurrency}
            data-testid={`cost-worklist-currency-${slug}`}
            onChange={(event) => setDraftCurrency(event.target.value)}
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
          <Button
            type="submit"
            className="button--sm"
            disabled={setCost.isPending}
            data-testid={`cost-worklist-save-${slug}`}
          >
            Save
          </Button>
          {draftError ? (
            <span className="form-field__error" role="alert">
              {COST_ERROR_COPY}
            </span>
          ) : null}
        </form>
      );
    }
    return (
      <Button
        type="button"
        tone="secondary"
        className="button--sm"
        onClick={() => startEdit(row)}
        data-testid={`cost-worklist-add-${slug}`}
      >
        Add cost
      </Button>
    );
  }

  function renderBody(): ReactElement {
    if (rowsQuery.isLoading) {
      return <LoadingState title="Loading variants" message="Fetching the work list…" />;
    }
    if (rowsQuery.isError) {
      return (
        <ErrorState
          title="Unable to load the cost list"
          message={rowsQuery.error.message}
          action={<Button onClick={() => void rowsQuery.refetch()}>Retry</Button>}
        />
      );
    }
    if (soldDone) {
      return (
        <article className="panel panel--dense">
          <div data-testid="cost-worklist-done-empty">
            <EmptyState
              title="Every variant you sold has a cost"
              message={
                unsoldMissing !== null && unsoldMissing > 0
                  ? `New orders count fully toward margin. ${String(unsoldMissing)} variants have not sold in 30 days and have no cost; they show up here as soon as one sells.`
                  : 'New orders count fully toward margin.'
              }
              action={
                <>
                  <Link className="button button--secondary" to="/">
                    Open Margin
                  </Link>{' '}
                  {unsoldMissing !== null && unsoldMissing > 0 ? (
                    <Link className="button button--ghost" to="/products/cost-prices?tab=all">
                      Show the {unsoldMissing} variants
                    </Link>
                  ) : null}
                </>
              }
            />
          </div>
        </article>
      );
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          title="No variants match"
          message={
            unfiltered
              ? 'There is nothing in this list.'
              : 'Nothing matches this search or channel. Clear a filter to see more.'
          }
        />
      );
    }
    return (
      <>
        <div
          className="data-table__container"
          tabIndex={0}
          role="region"
          aria-label="Variants (scrollable)"
        >
          <table className="data-table" data-testid="cost-worklist-table" ref={tableRef}>
            <caption className="sr-only">
              Variants by net sales in the last 30 days, with their cost price
            </caption>
            <thead>
              <tr>
                {showEditing ? (
                  <th className="cost-worklist__check">
                    <CheckboxCell
                      state={allSelected ? 'all' : someSelected ? 'some' : 'none'}
                      onToggle={toggleAll}
                      disabled={selectable.length === 0}
                      ariaLabel="Select all on this page"
                    />
                  </th>
                ) : null}
                <th>Variant</th>
                <th className="cost-worklist__num">Units, 30 d</th>
                <th className="cost-worklist__num">
                  Net sales{reportingCurrency ? `, ${reportingCurrency}` : ''}
                </th>
                {showRunningShare ? (
                  <th className="cost-worklist__num data-table__cell--hide-below-768">
                    Running share
                  </th>
                ) : null}
                <th className="data-table__cell--hide-below-1024">Sold on</th>
                <th className="data-table__cell--right">Cost, net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const slug = rowSlug(row);
                cumulative += row.netSales30d;
                const share =
                  showRunningShare && coverage
                    ? Math.min(100, Math.round((cumulative / coverage.netSalesWithoutCost) * 100))
                    : null;
                const isSaved = saved[row.variantId] !== undefined;
                return (
                  <tr
                    key={row.variantId}
                    className={isSaved ? 'cost-worklist__row-saved' : undefined}
                    data-testid={`cost-worklist-row-${slug}`}
                  >
                    {showEditing ? (
                      <td className="cost-worklist__check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.sku ?? rowLabel(row)}`}
                          checked={selected.has(row.variantId)}
                          disabled={!needsCost(row)}
                          onChange={() => toggleRow(row.variantId)}
                          data-testid={`cost-worklist-select-${slug}`}
                        />
                      </td>
                    ) : null}
                    <td>
                      <div className="cost-worklist__name">
                        <Link to={`/products/${row.productId}`}>{rowLabel(row)}</Link>
                        {row.sku ? <span className="cost-worklist__sku">{row.sku}</span> : null}
                      </div>
                    </td>
                    <td className="cost-worklist__num">{row.units30d}</td>
                    <td className="cost-worklist__num">
                      {row.netSales30d > 0 ? formatAmount(row.netSales30d, rowsQuery.data?.currency) : '—'}
                    </td>
                    {showRunningShare ? (
                      <td className="cost-worklist__num data-table__cell--hide-below-768">
                        {share === null ? '—' : `${String(share)}%`}
                      </td>
                    ) : null}
                    <td className="data-table__cell--hide-below-1024 text-muted">
                      {row.soldOn.length > 0
                        ? row.soldOn.map((s) => s.name ?? s.platformType ?? s.connectionId).join(', ')
                        : '—'}
                    </td>
                    <td className="data-table__cell--right">{renderCostCell(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ListPagination
          offset={offset}
          limit={PAGE_SIZE}
          rowCount={rows.length}
          total={totalStage.total}
          totalState={totalStage.state}
          showTotalLoader={totalStage.showLoader}
          onOffsetChange={(next) => setParam('offset', next > 0 ? String(next) : '')}
        />
        <p className="data-table__footnote">
          {tab === 'sold'
            ? 'Sorted by net sales in the last 30 days. '
            : 'Sorted by net sales in the last 30 days, then by name. '}
          {coverage && coverage.top3.length > 0 && coverage.top3SharePct !== null && tab === 'sold'
            ? `The first ${String(coverage.top3.length)} variants are ${String(Math.round(coverage.top3SharePct))}% of the sales left out of margin. `
            : ''}
          {showEditing ? 'Enter saves a row and moves to the next.' : ''}
        </p>
      </>
    );
  }

  return (
    <PageLayout
      eyebrow="Products"
      title="Cost prices"
      description="What you pay for each variant, excluding VAT. Used only for margin on Analytics."
      backTo={{ to: '/products', label: 'Products' }}
    >
      <div className="cost-worklist" data-testid="cost-worklist-state">
        {!trackMargin ? (
          <Alert tone="info" data-testid="cost-tracking-off-note">
            Margin tracking is off. Cost prices you enter here are still saved and copied onto new
            orders; the Margin panel and the reminders stay hidden until an admin turns tracking
            back on in Analytics settings.
          </Alert>
        ) : null}
        {!canEdit && !write.demoReadOnly ? (
          <Alert tone="info" title="You can see cost prices but not change them" data-testid="cost-worklist-readonly">
            Only an admin can add or change a cost price. Send them this page: the list is already
            sorted by what matters most.
          </Alert>
        ) : null}

        <section className="status-strip" aria-label="Cost coverage">
          <CostKpi
            testId="cost-kpi-sold-missing"
            label="Sold in 30 days, no cost"
            tone={coverage && coverage.soldVariantsWithoutCost > 0 ? 'warning' : 'success'}
            value={coverage ? String(coverage.soldVariantsWithoutCost) : '—'}
            metric={
              coverage
                ? coverage.soldVariantsWithoutCost === 0
                  ? 'All sold variants have a cost'
                  : `Of ${String(coverage.soldVariantCount)} variants sold`
                : undefined
            }
          />
          {coverage && coverage.soldVariantsWithoutCost === 0 && unsoldMissing !== null ? (
            <CostKpi
              testId="cost-kpi-unsold-missing"
              label="Never sold, no cost"
              value={String(unsoldMissing)}
              metric="Not urgent: they do not affect margin yet"
            />
          ) : (
            <>
              <CostKpi
                testId="cost-kpi-gap-amount"
                label="Net sales not in margin"
                value={coverage ? formatAmount(coverage.netSalesWithoutCost, coverage.currency) : '—'}
                metric="Last 30 days, these variants"
              />
              <CostKpi
                testId="cost-kpi-expected"
                label="Share of net sales with a cost"
                value={coveragePct === null ? '—' : `${coveragePct.toFixed(1)}%`}
                metric="Last 30 days; a cost counts from the next order"
              />
            </>
          )}
        </section>

        {coveragePct !== null ? (
          <article className="panel panel--dense">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Last 30 days</p>
                <h3 className="section-title">Share of net sales with a cost</h3>
              </div>
              <span className="panel__meta">
                Costs count from the next order on, so past orders stay as they are.
              </span>
            </div>
            <div className="cost-coverage" data-testid="cost-coverage-meter">
              <div
                className="cost-coverage__track"
                role="img"
                aria-label={`With a cost: ${coveragePct.toFixed(1)} percent of net sales`}
              >
                <div className="cost-coverage__fill" style={{ width: `${String(coveragePct)}%` }} />
              </div>
              <div className="cost-coverage__legend">
                <span>With a cost: {coveragePct.toFixed(1)}% of net sales</span>
                <span>Not in margin: {(100 - coveragePct).toFixed(1)}%</span>
              </div>
            </div>
          </article>
        ) : null}

        <div className="cost-worklist__tabs-row">
          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (isTab(value)) setParam('tab', value === 'sold' ? '' : value);
            }}
          >
            <TabsList aria-label="Which variants">
              {(
                [
                  ['sold', 'Sold, no cost'],
                  ['all', 'All without cost'],
                  ['has-cost', 'Has cost'],
                ] as const
              ).map(([value, label]) => (
                <TabsTrigger key={value} value={value} data-testid={`cost-worklist-tab-${value}`}>
                  {label}
                  {tabCount(value) !== null ? (
                    <span className="tabs__count">{tabCount(value)}</span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="cost-worklist__toolbar">
            <input
              className="control"
              type="search"
              placeholder="Search variant, SKU"
              aria-label="Search variants"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              data-testid="cost-worklist-search"
            />
            <Select
              aria-label="Channel"
              value={channel}
              onChange={(event) => setParam('channel', event.target.value)}
              data-testid="cost-worklist-channel"
            >
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {showEditing ? (
          <BulkActionBar
            count={selectedRows.length}
            itemNoun="variant"
            data-testid="cost-worklist-bulk-bar"
            actions={
              <>
                <Button
                  type="button"
                  className="button--sm"
                  onClick={openBulk}
                  data-testid="cost-worklist-bulk-open"
                >
                  Set one cost for selected
                </Button>
                <Button
                  type="button"
                  tone="ghost"
                  className="button--sm"
                  onClick={() => setSelected(new Set())}
                >
                  Clear selection
                </Button>
              </>
            }
          />
        ) : null}

        {renderBody()}
      </div>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent data-testid="cost-bulk-dialog" aria-label="Set one cost">
          <DialogTitle>
            Set one cost for {selectedRows.length} {selectedRows.length === 1 ? 'variant' : 'variants'}
          </DialogTitle>
          <DialogDescription>
            Use this when the variants cost you the same, like two colours of one cup.
          </DialogDescription>
          <div className="form-field">
            <label className="form-field__label" htmlFor="cost-bulk-input">
              Cost price, net per unit
            </label>
            <div className="cost-worklist__inline">
              <div className={`field__price-input${bulkError ? ' has-error' : ''}`}>
                <Input
                  id="cost-bulk-input"
                  inputMode="decimal"
                  autoComplete="off"
                  value={bulkDraft}
                  aria-invalid={bulkError ? true : undefined}
                  data-testid="cost-bulk-input"
                  onChange={(event) => {
                    setBulkDraft(event.target.value);
                    setBulkError(false);
                  }}
                />
                <span className="field__currency">net</span>
              </div>
              <Select
                aria-label="Cost currency"
                value={bulkCurrency}
                data-testid="cost-bulk-currency"
                onChange={(event) => setBulkCurrency(event.target.value)}
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
            <p className="form-field__description">
              Excluding VAT. Counts toward margin for orders placed after you save. Earlier orders
              keep no cost.
            </p>
            {bulkError ? (
              <p className="form-field__error" role="alert" data-testid="cost-bulk-error">
                {COST_ERROR_COPY}
              </p>
            ) : null}
          </div>
          <div>
            <p className="form-field__label">Applies to</p>
            <ul className="cost-worklist__preview" data-testid="cost-bulk-preview">
              {selectedRows.map((row) => (
                <li key={row.variantId}>
                  <span>
                    {rowLabel(row)}
                    {row.sku ? <span className="cost-worklist__sku"> {row.sku}</span> : null}
                  </span>
                  <span className="mono-text">
                    no cost →{' '}
                    {parseCostInput(bulkDraft) !== null
                      ? `${bulkCurrency} ${formatCostAmount(parseCostInput(bulkDraft) ?? '0')}`
                      : '…'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-muted">
            Variants that already have a cost are never selected here, so nothing gets overwritten.
          </p>
          <DialogFooter>
            <Button
              type="button"
              tone="ghost"
              onClick={() => setBulkOpen(false)}
              data-testid="cost-bulk-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={bulkFill.isPending || selectedRows.length === 0}
              onClick={saveBulk}
              data-testid="cost-bulk-save"
            >
              Save cost for {selectedRows.length} {selectedRows.length === 1 ? 'variant' : 'variants'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
