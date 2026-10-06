/**
 * Orders list filter bar (#3507, mockup m4b-orders-filters)
 *
 * The search + filter surface above the orders table, replacing the
 * eight-control toolbar and its three chip rows:
 *
 *   [⌕ Search …  /] [Filters (n) ▾]                               69 results
 *   Source Allegro ×   Tag ● VIP ×   Clear all          ← only when narrowed
 *   NEEDS A LOOK [Ship-by ≤ 24h] [Sales docs blocked 30] … │ PHASE [Ready 183] …
 *
 * "Filters" discloses an accordion `FilterPanel` (four groups) on a desktop and
 * a bottom `FilterSheet` with `<details>` sections on a phone. Nothing here
 * owns filter state: every control writes the URL through
 * `useOrderListFilters` immediately, exactly as the old toolbar did — the panel
 * is a better ORGANISATION of the same controls, so the URL contract, the
 * export "current view" and every URL-based test are unchanged.
 *
 * Keyboard: `/` focuses search, `F` toggles the panel (both ignored while
 * typing in a field, the guard the page's `R` shortcut uses).
 *
 * @module apps/web/src/features/orders/components
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ActiveFilterChips, type ActiveFilterChip } from '../../../shared/ui/active-filter-chips';
import { Button } from '../../../shared/ui/button';
import { Chip, type ChipTone } from '../../../shared/ui/chip';
import { FilterCheck, FilterChecks } from '../../../shared/ui/filter-check';
import {
  FilterField,
  FilterGroup,
  FilterPanel,
  FilterPanelFooter,
  FilterRange,
} from '../../../shared/ui/filter-panel';
import { FilterSection, FilterSheet } from '../../../shared/ui/filter-sheet';
import { FilterToggleButton } from '../../../shared/ui/filter-toggle-button';
import { Input } from '../../../shared/ui/input';
import { QuickFilters, QuickFiltersLabel, QuickFiltersSeparator } from '../../../shared/ui/quick-filters';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Select } from '../../../shared/ui/select';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useMediaQuery } from '../../../shared/ui/use-media-query';
import { oldestAgeSuffix } from '../../../shared/lib/oldest-age-suffix';
import type {
  OrderHealthSummary,
  OrderLifecyclePhaseSummary,
  OrderSlaSummary,
  OrderTag,
  SlaStateValue,
} from '../api/orders.types';
import type { UseOrderListFiltersResult } from '../hooks/use-order-list-filters';
import {
  ORDER_FILTER_DESCRIPTORS,
  buildOrderFilterChips,
  type OrderFilterChipContext,
  type OrderFilterGroup,
} from '../lib/order-filter-descriptors';
import { HOLD_REASON_COPY, HoldReasonValues } from '../lib/order-hold.types';
import { ORDER_LIFECYCLE_PHASE_META, OrderLifecyclePhaseValues } from '../lib/order-lifecycle-phase';
import type { OrderLifecyclePhaseValue } from '../lib/order-lifecycle-phase.types';
import {
  FULFILLMENT_FILTER_OPTIONS,
  ORDERS_LIST_FILTERS_COPY as COPY,
  SLA_FILTER_OPTIONS,
} from '../lib/orders-list-filters.copy';
import { OrderTagChip } from './order-tag-chip';

/** Per-browser memory of the panel being open — a view preference, not a filter, so never in the URL. */
const PANEL_OPEN_STORAGE_KEY = 'ol.orders-list.filters-open.v1';
/** Above this many tags the Tags group gets its own find box. */
const TAG_FIND_THRESHOLD = 8;
const MOBILE_QUERY = '(max-width: 767.98px)';

/**
 * Phase → `OrderLifecyclePhaseSummary` field (#2310). The summary is camelCase
 * per bucket while the phase union is snake_case; an exhaustive `Record` makes
 * a new phase a compile error here rather than a silently missing count.
 */
const PHASE_SUMMARY_KEY: Record<
  OrderLifecyclePhaseValue,
  keyof Omit<OrderLifecyclePhaseSummary, 'total'>
> = {
  cancelled: 'cancelled',
  vendor_authoritative: 'vendorAuthoritative',
  delivered: 'delivered',
  in_transit: 'inTransit',
  fulfillment_failed: 'fulfillmentFailed',
  held: 'held',
  amending: 'amending',
  blocked: 'blocked',
  ready: 'ready',
};

/**
 * `StatusBadgeTone` → `ChipTone` (#2310). Exhaustive: a tone added to the badge
 * family is a compile error here instead of silently widening the chip.
 */
const CHIP_TONE_FOR_PHASE_TONE: Record<StatusBadgeTone, ChipTone> = {
  conflict: 'warning',
  error: 'error',
  info: 'info',
  neutral: 'neutral',
  review: 'neutral',
  success: 'success',
  warning: 'warning',
};

type SlaChoice = SlaStateValue | 'any';

function readPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(PANEL_OPEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PANEL_OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Storage blocked (private window): the panel just forgets, which is fine.
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export interface OrderListFilterBarProps {
  filtersApi: UseOrderListFiltersResult;
  sources: readonly { id: string; name: string }[];
  tags: readonly OrderTag[];
  tagById: (id: string) => OrderTag | undefined;
  summary: OrderHealthSummary | undefined;
  slaSummary: OrderSlaSummary | undefined;
  lifecycleSummary: OrderLifecyclePhaseSummary | undefined;
  /** Already formatted ("69", "100+"); `null` while unknown — never shown as 0. */
  resultCount: string | null;
  /** `false` only when the install is known not to store buyer data (G03-14). */
  storesPersonalData: boolean | undefined;
  formatDay: (ymd: string) => string;
}

export function OrderListFilterBar({
  filtersApi,
  sources,
  tags,
  tagById,
  summary,
  slaSummary,
  lifecycleSummary,
  resultCount,
  storesPersonalData,
  formatDay,
}: OrderListFilterBarProps): ReactElement {
  const { state } = filtersApi;
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const panelId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [panelOpen, setPanelOpenState] = useState<boolean>(readPanelOpen);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tagFind, setTagFind] = useState('');

  const setPanelOpen = (open: boolean): void => {
    setPanelOpenState(open);
    writePanelOpen(open);
  };

  const chipCtx: OrderFilterChipContext = useMemo(
    () => ({
      connectionName: (id) => sources.find((s) => s.id === id)?.name,
      tagById,
      formatDay,
    }),
    [sources, tagById, formatDay],
  );
  const chipSpecs = useMemo(() => buildOrderFilterChips(state, chipCtx), [state, chipCtx]);
  const activeCount = chipSpecs.length;

  const activeChips: ActiveFilterChip[] = chipSpecs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    valueText: spec.valueText,
    value: spec.tag ? <OrderTagChip tag={spec.tag} small /> : spec.valueText,
    onRemove: () => filtersApi.clear(spec.clears),
  }));

  const groupSummary = (group: OrderFilterGroup): { text: string; active: boolean } => {
    const specs = buildOrderFilterChips(state, chipCtx, { includeUncounted: true }).filter(
      (spec) => ORDER_FILTER_DESCRIPTORS[spec.key].group === group,
    );
    return specs.length === 0
      ? { text: group === 'exceptions' ? COPY.sectionNone : COPY.sectionAny, active: false }
      : { text: specs.map((s) => s.valueText).join(', '), active: true };
  };

  // `/` and `F` — the same field-typing guard as the page's `R` refresh.
  useEffect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (isMobile) setSheetOpen((open) => !open);
        else setPanelOpenState((open) => {
          writePanelOpen(!open);
          return !open;
        });
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('keydown', onKeydown);
    };
  }, [isMobile]);

  const slaValue: SlaChoice = state.slaState ?? 'any';
  const slaOptions: { value: SlaChoice; label: string }[] = [
    { value: 'any', label: COPY.anySla },
    ...SLA_FILTER_OPTIONS,
  ];
  const packingValue = state.packed === undefined ? '' : String(state.packed);
  const tagRadioValue = state.untagged ? '__untagged__' : (state.tag ?? '');
  const visibleTags =
    tagFind.trim().length > 0
      ? tags.filter((t) => t.name.toLowerCase().includes(tagFind.trim().toLowerCase()))
      : tags;

  // ── Controls, shared verbatim by the desktop panel and the mobile sheet ──
  const sourceField = (
    <FilterField label={COPY.fieldSource}>
      <Select
        aria-label={COPY.fieldSource}
        value={state.sourceConnectionId ?? ''}
        onChange={(e) => {
          filtersApi.setFilter('sourceConnectionId', e.target.value);
        }}
      >
        <option value="">{COPY.allSources}</option>
        {sources.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </FilterField>
  );
  const createdField = (
    <FilterField label={COPY.fieldCreated} as="div">
      <FilterRange
        rows={[
          {
            label: COPY.createdFrom,
            control: (
              <input
                type="date"
                className="control"
                aria-label={COPY.createdFromAria}
                value={state.createdFrom ?? ''}
                onChange={(e) => {
                  filtersApi.setFilter('createdFrom', e.target.value);
                }}
              />
            ),
          },
          {
            label: COPY.createdTo,
            control: (
              <input
                type="date"
                className="control"
                aria-label={COPY.createdToAria}
                value={state.createdTo ?? ''}
                onChange={(e) => {
                  filtersApi.setFilter('createdTo', e.target.value);
                }}
              />
            ),
          },
        ]}
      />
    </FilterField>
  );
  const fulfillmentField = (
    <FilterField label={COPY.fieldFulfillment}>
      <Select
        aria-label={COPY.fieldFulfillment}
        value={state.fulfillmentState ?? ''}
        onChange={(e) => {
          filtersApi.setFilter('fulfillmentState', e.target.value);
        }}
      >
        <option value="">{COPY.anyFulfillment}</option>
        {FULFILLMENT_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </FilterField>
  );
  const shipByField = (
    <FilterField label={COPY.fieldShipBy} as="div">
      <SegmentedControl<SlaChoice>
        aria-label={COPY.fieldShipBy}
        options={slaOptions}
        value={slaValue}
        onChange={(next) => {
          filtersApi.setFilter('slaState', next === 'any' ? null : next);
        }}
      />
    </FilterField>
  );
  const packingField = (
    <FilterField label={COPY.fieldPacking}>
      <Select
        aria-label={COPY.fieldPacking}
        value={packingValue}
        onChange={(e) => {
          filtersApi.setFilter('packed', e.target.value);
        }}
      >
        <option value="">{COPY.anyPacking}</option>
        <option value="true">{COPY.packedYes}</option>
        <option value="false">{COPY.packedNo}</option>
      </Select>
    </FilterField>
  );
  const holdField = (
    <FilterField label={COPY.fieldHold}>
      <Select
        aria-label={COPY.fieldHold}
        value={state.holdReason ?? ''}
        onChange={(e) => {
          filtersApi.setFilter('holdReason', e.target.value);
        }}
      >
        <option value="">{COPY.anyHold}</option>
        {HoldReasonValues.map((value) => (
          <option key={value} value={value}>
            {HOLD_REASON_COPY[value].label}
          </option>
        ))}
      </Select>
    </FilterField>
  );
  const exceptionChecks = (
    <FilterChecks>
      <FilterCheck
        label={COPY.checkSalesDocsBlocked}
        tone="error"
        checked={state.invoicingBlocked}
        count={summary?.salesDocumentBlocked}
        onChange={() => {
          filtersApi.toggle('salesDocumentBlocked');
        }}
      />
      <FilterCheck
        label={COPY.checkOmsStopped}
        tone="error"
        checked={state.omsAttention}
        count={summary?.omsAttention}
        onChange={() => {
          filtersApi.toggle('attention');
        }}
      />
      <FilterCheck
        label={COPY.checkRateConflict}
        checked={state.rateConflict}
        count={summary?.taxRateConflict}
        onChange={() => {
          filtersApi.toggle('taxRateConflict');
        }}
      />
      <FilterCheck
        label={COPY.checkOpenReturn}
        checked={state.openReturn}
        onChange={() => {
          filtersApi.toggle('openReturn');
        }}
      />
    </FilterChecks>
  );
  const tagRadioName = `${panelId}-tag`;
  const tagList = (
    <>
      {tags.length > TAG_FIND_THRESHOLD ? (
        <Input
          type="search"
          aria-label={COPY.findTag}
          placeholder={COPY.findTag}
          value={tagFind}
          onChange={(e) => {
            setTagFind(e.target.value);
          }}
        />
      ) : null}
      <FilterChecks role="radiogroup" aria-label={COPY.tagGroupAria} scroll>
        <FilterCheck
          type="radio"
          name={tagRadioName}
          label={COPY.anyTag}
          checked={tagRadioValue === ''}
          onChange={() => {
            filtersApi.setTagFilter(null);
          }}
        />
        {visibleTags.map((t) => (
          <FilterCheck
            key={t.id}
            type="radio"
            name={tagRadioName}
            aria-label={t.name}
            label={<OrderTagChip tag={t} small />}
            count={t.orderCount}
            checked={tagRadioValue === t.id}
            onChange={() => {
              filtersApi.setTagFilter({ tag: t.id });
            }}
          />
        ))}
        <FilterCheck
          type="radio"
          name={tagRadioName}
          label={COPY.noTags}
          mutedLabel
          checked={tagRadioValue === '__untagged__'}
          onChange={() => {
            filtersApi.setTagFilter({ untagged: true });
          }}
        />
      </FilterChecks>
      {tags.length === 0 ? <span className="filter-panel__hint">{COPY.noTagsYet}</span> : null}
    </>
  );

  // ── Quick filters row ──
  const salesDocsBlocked = summary?.salesDocumentBlocked;
  const phaseChips = OrderLifecyclePhaseValues.map((value) => {
    const count = lifecycleSummary?.[PHASE_SUMMARY_KEY[value]];
    const active = state.phase === value;
    // Mount on `active || count`: a zero-count chip is noise, but the ACTIVE
    // chip must stay or the only way to clear an applied `?phase=` vanishes
    // the moment its last order moves on (#2310 / #2100).
    if (!active && !count) return null;
    const meta = ORDER_LIFECYCLE_PHASE_META[value];
    return (
      <Chip
        key={value}
        tone={CHIP_TONE_FOR_PHASE_TONE[meta.tone]}
        active={active}
        onClick={() => {
          filtersApi.togglePhase(value);
        }}
      >
        {meta.label}
        {count === undefined ? null : <span className="chip__count">{count}</span>}
      </Chip>
    );
  });
  const atRiskAny = slaSummary !== undefined && (slaSummary.overdue > 0 || slaSummary.atRisk > 0);
  const quickEnd = (
    <>
      {slaSummary && slaSummary.overdue > 0 ? (
        <StatusBadge tone="error" withDot compact>
          {COPY.overdue(slaSummary.overdue)}
        </StatusBadge>
      ) : null}
      {slaSummary && slaSummary.atRisk > 0 ? (
        <StatusBadge tone="warning" withDot compact>
          {COPY.atRisk(slaSummary.atRisk)}
        </StatusBadge>
      ) : null}
      {/* Unconditional (#2441 review I3): the risk page's most useful states
          are the ones reachable when nothing is breaching. */}
      <Link className="nav-link" to="/orders/dispatch-risk">
        {atRiskAny ? COPY.reviewDispatchRisk : COPY.dispatchRiskOverview}
      </Link>
    </>
  );

  const placeholder =
    storesPersonalData === false ? COPY.searchPlaceholderNoPii : COPY.searchPlaceholderWithPii;

  // The phone sheet's sections — the same controls as the desktop panel, plus
  // the lifecycle stage (on a desktop it is the quick-filter row). Bodies are
  // declared first so the section table below holds no JSX.
  const sourceBody = (
    <>
      {sourceField}
      {createdField}
    </>
  );
  const shipmentBody = (
    <>
      {fulfillmentField}
      {shipByField}
      {packingField}
    </>
  );
  const exceptionsBody = (
    <>
      {holdField}
      {exceptionChecks}
    </>
  );
  const stageBody = (
    <FilterChecks role="radiogroup" aria-label={COPY.groupPhase}>
      <FilterCheck
        type="radio"
        name={`${panelId}-phase`}
        label={COPY.anyPhase}
        checked={state.phase === undefined}
        onChange={() => {
          if (state.phase) filtersApi.togglePhase(state.phase);
        }}
      />
      {OrderLifecyclePhaseValues.map((value) => {
        const count = lifecycleSummary?.[PHASE_SUMMARY_KEY[value]];
        if (state.phase !== value && !count) return null;
        return (
          <FilterCheck
            key={value}
            type="radio"
            name={`${panelId}-phase`}
            label={ORDER_LIFECYCLE_PHASE_META[value].label}
            count={count}
            checked={state.phase === value}
            onChange={() => {
              filtersApi.togglePhase(value);
            }}
          />
        );
      })}
    </FilterChecks>
  );
  const sheetSections: ReadonlyArray<readonly [OrderFilterGroup, string, ReactElement]> = [
    ['source', COPY.groupSource, sourceBody],
    ['shipment', COPY.groupShipment, shipmentBody],
    ['exceptions', COPY.groupExceptions, exceptionsBody],
    ['tags', COPY.groupTags, tagList],
    ['phase', COPY.groupPhase, stageBody],
  ];
  const firstActiveSection = sheetSections.findIndex(([g]) => groupSummary(g).active);

  const panelVisible = panelOpen && !isMobile;

  return (
    <div className="orders-filters">
      <div className="orders-filterbar">
        <div className="orders-filterbar__search">
          <span className="orders-filterbar__search-glyph" aria-hidden="true">
            ⌕
          </span>
          <Input
            ref={searchRef}
            type="search"
            aria-label={COPY.searchLabel}
            placeholder={placeholder}
            value={filtersApi.searchInput}
            onChange={(e) => {
              filtersApi.setSearch(e.target.value);
            }}
          />
          <span className="button__shortcut orders-filterbar__kbd" aria-hidden="true">
            {COPY.searchShortcut}
          </span>
        </div>
        <FilterToggleButton
          ref={toggleRef}
          data-testid="orders-filter-toggle"
          expanded={isMobile ? sheetOpen : panelOpen}
          controls={isMobile ? undefined : panelId}
          aria-haspopup={isMobile ? 'dialog' : undefined}
          count={activeCount}
          title={COPY.toggleTitle}
          onClick={() => {
            if (isMobile) setSheetOpen(true);
            else setPanelOpen(!panelOpen);
          }}
        />
        <span className="text-muted mono tabular orders-filterbar__count" aria-live="polite">
          {resultCount === null ? null : COPY.results(resultCount)}
        </span>
      </div>

      {/* The open panel shows the same values as the chips, so the chip row
          steps aside while it is open rather than saying everything twice. */}
      {panelVisible ? null : (
        <ActiveFilterChips
          chips={activeChips}
          onClearAll={filtersApi.clearAll}
          onEmptyFocus={() => toggleRef.current?.focus()}
          clearAllLabel={COPY.clearAll}
        />
      )}

      {panelVisible ? (
        <FilterPanel
          id={panelId}
          footer={
            <FilterPanelFooter
              hint={COPY.panelHint}
              actions={
                <>
                  {activeCount > 0 ? (
                    <Button tone="ghost" className="button--sm" onClick={filtersApi.clearAll}>
                      {COPY.clearAll}
                    </Button>
                  ) : null}
                  <Button
                    tone="ghost"
                    className="button--sm"
                    onClick={() => {
                      setPanelOpen(false);
                      toggleRef.current?.focus();
                    }}
                  >
                    {COPY.hideFilters}
                  </Button>
                </>
              }
            />
          }
        >
          <FilterGroup legend={COPY.groupSource}>
            {sourceField}
            {createdField}
          </FilterGroup>
          <FilterGroup legend={COPY.groupShipment}>
            {fulfillmentField}
            {shipByField}
            {packingField}
          </FilterGroup>
          <FilterGroup legend={COPY.groupExceptions}>
            {holdField}
            {exceptionChecks}
          </FilterGroup>
          <FilterGroup legend={COPY.groupTags}>{tagList}</FilterGroup>
        </FilterPanel>
      ) : null}

      <QuickFilters aria-label={COPY.quickFiltersAria} end={quickEnd}>
        <QuickFiltersLabel>{COPY.quickNeedsLook}</QuickFiltersLabel>
        <Chip
          tone="warning"
          active={state.breaching}
          onClick={() => {
            filtersApi.toggle('dueBefore');
          }}
        >
          {COPY.quickBreaching}
        </Chip>
        {state.invoicingBlocked || salesDocsBlocked ? (
          <Chip
            tone="error"
            active={state.invoicingBlocked}
            title={
              summary?.salesDocumentIssuedOnRequest
                ? COPY.quickSalesDocsTitle(summary.salesDocumentIssuedOnRequest)
                : undefined
            }
            onClick={() => {
              filtersApi.toggle('salesDocumentBlocked');
            }}
          >
            {COPY.quickSalesDocs}
            {salesDocsBlocked === undefined ? null : (
              <span className="chip__count">
                {`${salesDocsBlocked}${oldestAgeSuffix(summary?.salesDocumentBlockedOldestAt)}`}
              </span>
            )}
          </Chip>
        ) : null}
        {state.rateConflict || summary?.taxRateConflict ? (
          <Chip
            active={state.rateConflict}
            onClick={() => {
              filtersApi.toggle('taxRateConflict');
            }}
          >
            {COPY.quickRateConflict}
            {summary?.taxRateConflict === undefined ? null : (
              <span className="chip__count">{summary.taxRateConflict}</span>
            )}
          </Chip>
        ) : null}
        {state.omsAttention || summary?.omsAttention ? (
          <Chip
            tone="error"
            active={state.omsAttention}
            onClick={() => {
              filtersApi.toggle('attention');
            }}
          >
            {COPY.quickOmsStopped}
            {summary?.omsAttention === undefined ? null : (
              <span className="chip__count">{summary.omsAttention}</span>
            )}
          </Chip>
        ) : null}
        <Chip
          active={state.openReturn}
          onClick={() => {
            filtersApi.toggle('openReturn');
          }}
        >
          {COPY.quickOpenReturn}
        </Chip>
        <QuickFiltersSeparator />
        <QuickFiltersLabel>{COPY.quickPhase}</QuickFiltersLabel>
        {phaseChips}
      </QuickFilters>

      {isMobile ? (
        <FilterSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={COPY.sheetTitle}
          description={COPY.panelHint}
          footer={
            <>
              <Button tone="secondary" onClick={filtersApi.clearAll}>
                {COPY.clearAll}
              </Button>
              <Button
                tone="primary"
                onClick={() => {
                  setSheetOpen(false);
                }}
              >
                {COPY.showOrders(resultCount)}
              </Button>
            </>
          }
        >
          {sheetSections.map(([group, title, body], index) => {
            const s = groupSummary(group);
            return (
              <FilterSection
                key={group}
                title={title}
                summary={s.text}
                active={s.active}
                defaultOpen={firstActiveSection === -1 ? index === 0 : index === firstActiveSection}
              >
                {body}
              </FilterSection>
            );
          })}
        </FilterSheet>
      ) : null}
    </div>
  );
}
