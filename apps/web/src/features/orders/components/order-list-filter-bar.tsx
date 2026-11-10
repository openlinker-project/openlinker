/**
 * Orders list filter bar (#3507, redesigned #4026)
 *
 * The toolbar above the orders table:
 *
 *   [⌕ Search …  /] [Stage ⌄|Source ⌄|Ship-by ⌄|≡ More (n) F]   69 results  Sort: Newest first ▼
 *   Source Allegro ×   Tag ● VIP ×   Clear all          ← whenever anything is applied
 *
 * Stage, Source and Ship-by are pinned single-choice filters with counts. "More"
 * opens every filter in a `SidePanel` (a side sheet on a desktop, a bottom
 * sheet on a phone) grouped into the same sections the old panel had. The
 * applied-filter pills stay visible whatever is open. Nothing here owns filter
 * state: every control writes the URL through `useOrderListFilters`, so the URL
 * contract, the export "current view" and URL-based tests are unchanged.
 *
 * Keyboard: `/` focuses search, `F` toggles the filter panel (both ignored
 * while typing in a field, the guard the page's `R` shortcut uses).
 *
 * @module apps/web/src/features/orders/components
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActiveFilterChips, type ActiveFilterChip } from '../../../shared/ui/active-filter-chips';
import { Button } from '../../../shared/ui/button';
import { FilterCheck, FilterChecks } from '../../../shared/ui/filter-check';
import { FilterField, FilterRange } from '../../../shared/ui/filter-panel';
import { FilterSection } from '../../../shared/ui/filter-sheet';
import { Input } from '../../../shared/ui/input';
import { FilterDropdown, FilterGroup, type FilterOptionDot } from '../../../shared/ui/filter-dropdown';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Select } from '../../../shared/ui/select';
import { SidePanel } from '../../../shared/ui/side-panel';
import { SortMenu } from '../../../shared/ui/sort-menu';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import type {
  OrderHealthSummary,
  OrderLifecyclePhaseSummary,
  OrderSlaSummary,
  OrderSortValue,
  OrderTag,
  SlaStateValue,
} from '../api/orders.types';
import {
  DEFAULT_ORDER_SORT,
  DEFAULT_ORDER_SORT_DIR,
  type UseOrderListFiltersResult,
} from '../hooks/use-order-list-filters';
import {
  ORDER_FILTER_DESCRIPTORS,
  ORDER_TOOLBAR_PINNED_FILTER_KEYS,
  FULFILLMENT_FILTER_VALUES,
  SLA_FILTER_VALUES,
  buildOrderFilterChips,
  type OrderFilterChipContext,
  type OrderFilterGroup,
} from '../lib/order-filter-descriptors';
import { HoldReasonValues, holdReasonLabel } from '../lib/order-hold.types';
import { ORDER_LIFECYCLE_PHASE_TONE, OrderLifecyclePhaseValues } from '../lib/order-lifecycle-phase';
import type { OrderLifecyclePhaseValue } from '../lib/order-lifecycle-phase.types';
import { useMessages, usePlural } from '../../../shared/i18n';
import { OrderTagChip } from './order-tag-chip';

/** Sort menu entries, in menu order; `createdAt` is the default. */
const ORDER_SORT_KEYS = [
  'createdAt',
  'placedAt',
  'dispatchBy',
  'customer',
  'status',
  'fulfillment',
  'total',
  'payment',
] as const satisfies readonly OrderSortValue[];

/** Above this many tags the Tags group gets its own find box. */
const TAG_FIND_THRESHOLD = 8;


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

const SLA_SUMMARY_KEY: Record<SlaStateValue, keyof OrderSlaSummary> = {
  overdue: 'overdue',
  at_risk: 'atRisk',
  on_track: 'onTrack',
  none: 'none',
};

type SlaChoice = SlaStateValue | 'any';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function phaseDotTone(tone: StatusBadgeTone): FilterOptionDot {
  if (tone === 'conflict') return 'warning';
  return tone === 'neutral' || tone === 'review' ? 'neutral' : tone;
}

export interface OrderListFilterBarProps {
  filtersApi: UseOrderListFiltersResult;
  sources: readonly { id: string; name: string }[];
  tags: readonly OrderTag[];
  tagById: (id: string) => OrderTag | undefined;
  summary: OrderHealthSummary | undefined;
  slaSummary: OrderSlaSummary | undefined;
  lifecycleSummary: OrderLifecyclePhaseSummary | undefined;
  /**
   * How many orders match: the exact total, or a floor ("100+") while the total
   * is still being counted. `null` while unknown - never shown as 0.
   */
  resultCount: { value: number; atLeast: boolean } | null;
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
  const giftCopy = useMessages('gifts');
  const orders = useMessages('orders');
  const COPY = orders.listFilters;
  const paymentCopy = orders.paymentWriteback;
  const plural = usePlural();
  const sortOptions = useMemo(
    () => ORDER_SORT_KEYS.map((key) => ({ key, label: COPY.sortOptions[key], dir: DEFAULT_ORDER_SORT_DIR[key] })),
    [COPY],
  );
  const panelId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tagFind, setTagFind] = useState('');

  const chipCtx: OrderFilterChipContext = useMemo(
    () => ({
      connectionName: (id) => sources.find((s) => s.id === id)?.name,
      tagById,
      formatDay,
      copy: orders,
    }),
    [sources, tagById, formatDay, orders],
  );
  // Every applied value is a pill — search and stage included — except the
  // status tab, which is the selected tab and needs no second rendering.
  const chipSpecs = useMemo(
    () =>
      buildOrderFilterChips(state, chipCtx, { includeUncounted: true }).filter(
        (spec) => spec.key !== 'health',
      ),
    [state, chipCtx],
  );
  const moreCount = chipSpecs.filter((spec) => !ORDER_TOOLBAR_PINNED_FILTER_KEYS.has(spec.key)).length;

  const activeChips: ActiveFilterChip[] = chipSpecs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    valueText: spec.valueText,
    value: spec.tag ? <OrderTagChip tag={spec.tag} small /> : spec.valueText,
    onRemove: () => {
      filtersApi.clear(spec.clears);
    },
  }));

  const groupSummary = (group: OrderFilterGroup): { text: string; active: boolean } => {
    const specs = chipSpecs.filter((spec) => ORDER_FILTER_DESCRIPTORS[spec.key].group === group);
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
        setSheetOpen((open) => !open);
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('keydown', onKeydown);
    };
  }, []);

  const slaValue: SlaChoice = state.slaState ?? 'any';
  const slaOptions: { value: SlaChoice; label: string }[] = [
    { value: 'any', label: COPY.anySla },
    ...SLA_FILTER_VALUES.map((value) => ({ value, label: COPY.slaOptions[value] })),
  ];
  const packingValue = state.packed === undefined ? '' : String(state.packed);
  const tagRadioValue = state.untagged ? '__untagged__' : (state.tag ?? '');
  const visibleTags =
    tagFind.trim().length > 0
      ? tags.filter((t) => t.name.toLowerCase().includes(tagFind.trim().toLowerCase()))
      : tags;

  // ── The "More" panel's controls (the old panel's, unchanged) ──
  const sourceBody = (
    <>
      <FilterField label={COPY.fields.source}>
        <Select
          aria-label={COPY.fields.source}
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
      <FilterField label={COPY.fields.created} as="div">
        <FilterRange
          rows={[
            {
              label: COPY.fields.createdFrom,
              control: (
                <input
                  type="date"
                  className="control"
                  aria-label={COPY.fields.createdFromAria}
                  value={state.createdFrom ?? ''}
                  onChange={(e) => {
                    filtersApi.setFilter('createdFrom', e.target.value);
                  }}
                />
              ),
            },
            {
              label: COPY.fields.createdTo,
              control: (
                <input
                  type="date"
                  className="control"
                  aria-label={COPY.fields.createdToAria}
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
    </>
  );
  const shipmentBody = (
    <>
      <FilterField label={COPY.fields.fulfilment}>
        <Select
          aria-label={COPY.fields.fulfilment}
          value={state.fulfillmentState ?? ''}
          onChange={(e) => {
            filtersApi.setFilter('fulfillmentState', e.target.value);
          }}
        >
          <option value="">{COPY.anyFulfilment}</option>
          {FULFILLMENT_FILTER_VALUES.map((value) => (
            <option key={value} value={value}>
              {COPY.fulfilmentOptions[value]}
            </option>
          ))}
        </Select>
      </FilterField>
      <FilterField label={COPY.fields.shipBy} as="div">
        <SegmentedControl<SlaChoice>
          aria-label={COPY.fields.shipBy}
          options={slaOptions}
          value={slaValue}
          onChange={(next) => {
            filtersApi.setFilter('slaState', next === 'any' ? null : next);
          }}
        />
        <FilterChecks>
          <FilterCheck
            label={COPY.quick.breaching}
            checked={state.breaching}
            count={summary?.dueWithin24h}
            onChange={() => {
              filtersApi.toggle('dueBefore');
            }}
          />
        </FilterChecks>
      </FilterField>
      <FilterField label={COPY.fields.packing}>
        <Select
          aria-label={COPY.fields.packing}
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
      <FilterChecks>
        <FilterCheck
          label={COPY.checks.packBench}
          checked={state.onPackBench}
          count={summary?.onPackBench}
          onChange={() => {
            filtersApi.toggle('onPackBench');
          }}
        />
      </FilterChecks>
    </>
  );
  const exceptionsBody = (
    <>
      <FilterField label={COPY.fields.hold}>
        <Select
          aria-label={COPY.fields.hold}
          value={state.holdReason ?? ''}
          onChange={(e) => {
            filtersApi.setFilter('holdReason', e.target.value);
          }}
        >
          <option value="">{COPY.anyHold}</option>
          {HoldReasonValues.map((value) => (
            <option key={value} value={value}>
              {holdReasonLabel(value)}
            </option>
          ))}
        </Select>
      </FilterField>
      <FilterChecks>
        <FilterCheck
          label={COPY.checks.salesDocsBlocked}
          tone="error"
          checked={state.invoicingBlocked}
          count={summary?.salesDocumentBlocked}
          onChange={() => {
            filtersApi.toggle('salesDocumentBlocked');
          }}
        />
        <FilterCheck
          label={COPY.checks.omsStopped}
          tone="error"
          checked={state.omsAttention}
          count={summary?.omsAttention}
          onChange={() => {
            filtersApi.toggle('attention');
          }}
        />
        <FilterCheck
          label={COPY.checks.shopChanged}
          tone="warning"
          checked={state.shopChanged}
          onChange={() => {
            filtersApi.toggle('attentionReason');
          }}
        />
        <FilterCheck
          label={paymentCopy.filterCheck}
          tone="warning"
          checked={state.paymentNotSent}
          count={summary?.paymentNotSent}
          onChange={() => {
            filtersApi.toggle('paymentNotSent');
          }}
        />
        <FilterCheck
          label={COPY.checks.waiting}
          tone="warning"
          checked={state.waitingInOpenLinker}
          count={summary?.waitingInOpenLinker}
          onChange={() => {
            filtersApi.toggle('waitingInOpenLinker');
          }}
        />
        <FilterCheck
          label={COPY.checks.routingBlocked}
          tone="error"
          checked={state.routingBlocked}
          count={summary?.destinationRoutingBlocked}
          onChange={() => {
            filtersApi.toggle('destinationRoutingBlocked');
          }}
        />
        <FilterCheck
          label={COPY.checks.rateConflict}
          checked={state.rateConflict}
          count={summary?.taxRateConflict}
          onChange={() => {
            filtersApi.toggle('taxRateConflict');
          }}
        />
        <FilterCheck
          label={COPY.checks.openReturn}
          checked={state.openReturn}
          count={summary?.openReturn}
          onChange={() => {
            filtersApi.toggle('openReturn');
          }}
        />
        <FilterCheck
          label={giftCopy.filter.check}
          checked={state.withGift}
          count={summary?.withGift}
          onChange={() => {
            filtersApi.toggle('withGift');
          }}
        />
        <FilterCheck
          label={giftCopy.filter.bundleCheck}
          checked={state.withBundle}
          count={summary?.withBundle}
          onChange={() => {
            filtersApi.toggle('withBundle');
          }}
        />
        <FilterCheck
          label={giftCopy.filter.notAddedCheck}
          checked={state.giftNotAdded}
          count={summary?.giftNotAdded}
          onChange={() => {
            filtersApi.toggle('giftNotAdded');
          }}
        />
        <FilterCheck
          label={giftCopy.filter.shopRejectedCheck}
          checked={state.giftShopRejected}
          count={summary?.giftShopRejected}
          onChange={() => {
            filtersApi.toggle('giftShopRejected');
          }}
        />
        <FilterCheck
          data-testid="orders-filter-buyer-note"
          label={COPY.checks.buyerNote}
          checked={state.hasBuyerNote}
          count={summary?.hasBuyerNote}
          onChange={() => {
            filtersApi.toggle('hasBuyerNote');
          }}
        />
      </FilterChecks>
    </>
  );
  const tagRadioName = `${panelId}-tag`;
  const tagsBody = (
    <>
      {tags.length > TAG_FIND_THRESHOLD ? (
        <Input
          type="search"
          aria-label={COPY.tags.find}
          placeholder={COPY.tags.find}
          value={tagFind}
          onChange={(e) => {
            setTagFind(e.target.value);
          }}
        />
      ) : null}
      <FilterChecks role="radiogroup" aria-label={COPY.tags.groupAria} scroll>
        <FilterCheck
          type="radio"
          name={tagRadioName}
          label={COPY.tags.any}
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
          label={COPY.tags.none}
          mutedLabel
          checked={tagRadioValue === '__untagged__'}
          onChange={() => {
            filtersApi.setTagFilter({ untagged: true });
          }}
        />
      </FilterChecks>
      {tags.length === 0 ? <span className="filter-panel__hint">{COPY.tags.noneYet}</span> : null}
    </>
  );
  const phaseOptions = OrderLifecyclePhaseValues.flatMap((value) => {
    const count = lifecycleSummary?.[PHASE_SUMMARY_KEY[value]];
    // A zero-count stage is noise, but the ACTIVE one must stay or the only
    // way to clear an applied `?phase=` vanishes with its last order (#2310).
    if (state.phase !== value && !count) return [];
    return [
      { value, label: orders.lifecyclePhase.labels[value], count, dot: phaseDotTone(ORDER_LIFECYCLE_PHASE_TONE[value]) },
    ];
  });
  const stageBody = (
    <FilterChecks role="radiogroup" aria-label={COPY.groups.phase}>
      <FilterCheck
        type="radio"
        name={`${panelId}-phase`}
        label={COPY.anyPhase}
        checked={state.phase === undefined}
        onChange={() => {
          if (state.phase) filtersApi.togglePhase(state.phase);
        }}
      />
      {phaseOptions.map((o) => (
        <FilterCheck
          key={o.value}
          type="radio"
          name={`${panelId}-phase`}
          label={o.label}
          count={o.count}
          checked={state.phase === o.value}
          onChange={() => {
            filtersApi.togglePhase(o.value);
          }}
        />
      ))}
    </FilterChecks>
  );
  // Objects, not tuples: the UI-vocabulary scan reads generic angle brackets
  // as JSX, so a group key between them would count as visible text.
  const sheetSections: readonly { group: OrderFilterGroup; title: string; body: ReactElement }[] = [
    { group: ORDER_FILTER_DESCRIPTORS.sourceConnectionId.group, title: COPY.groups.source, body: sourceBody },
    { group: ORDER_FILTER_DESCRIPTORS.fulfillmentState.group, title: COPY.groups.shipment, body: shipmentBody },
    { group: ORDER_FILTER_DESCRIPTORS.holdReason.group, title: COPY.groups.exceptions, body: exceptionsBody },
    { group: ORDER_FILTER_DESCRIPTORS.tag.group, title: COPY.groups.tags, body: tagsBody },
    { group: ORDER_FILTER_DESCRIPTORS.phase.group, title: COPY.groups.phase, body: stageBody },
  ];

  const placeholder =
    storesPersonalData === false ? COPY.search.placeholderNoPii : COPY.search.placeholderWithPii;

  return (
    <div className="orders-filters">
      <div className="list-toolbar">
        <div className="list-search">
          <span className="list-search__glyph" aria-hidden="true">
            ⌕
          </span>
          <Input
            ref={searchRef}
            type="search"
            aria-label={COPY.search.label}
            placeholder={placeholder}
            value={filtersApi.searchInput}
            onChange={(e) => {
              filtersApi.setSearch(e.target.value);
            }}
          />
          <span className="button__shortcut list-search__kbd" aria-hidden="true">
            /
          </span>
        </div>
        <FilterGroup aria-label={COPY.filterGroupAria}>
          <FilterDropdown
            label={COPY.quick.phase}
            anyLabel={COPY.anyPhase}
            value={state.phase ?? null}
            options={phaseOptions}
            onChange={(next) => {
              if (next === null) {
                if (state.phase) filtersApi.togglePhase(state.phase);
              } else if (next !== state.phase) {
                filtersApi.togglePhase(next);
              }
            }}
          />
          <FilterDropdown
            label={COPY.fields.source}
            anyLabel={COPY.allSources}
            value={state.sourceConnectionId ?? null}
            options={sources.map((c) => ({
              value: c.id,
              label: c.name,
              count: summary?.bySource?.[c.id],
            }))}
            onChange={(next) => {
              filtersApi.setFilter('sourceConnectionId', next);
            }}
          />
          <FilterDropdown
            label={COPY.fields.shipBy}
            anyLabel={COPY.anySla}
            value={state.slaState ?? null}
            options={SLA_FILTER_VALUES.map((value) => ({
              value,
              label: COPY.slaOptions[value],
              count: slaSummary?.[SLA_SUMMARY_KEY[value]],
            }))}
            onChange={(next) => {
              filtersApi.setFilter('slaState', next);
            }}
          />
          <button
            ref={moreRef}
            type="button"
            className={['joined-filters__btn', moreCount > 0 ? 'joined-filters__btn--on' : '']
              .filter(Boolean)
              .join(' ')}
            data-testid="orders-filter-toggle"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            title={COPY.moreFiltersTitle}
            onClick={() => {
              setSheetOpen(true);
            }}
          >
            <span aria-hidden="true">{'≡'}</span>
            {COPY.moreFilters}
            {moreCount > 0 ? <span className="button__count">{moreCount}</span> : null}
            <span className="button__shortcut" aria-hidden="true">
              F
            </span>
          </button>
        </FilterGroup>
        <button
          type="button"
          className={['gift-quick-filter', state.withGift ? 'gift-quick-filter--on' : '']
            .filter(Boolean)
            .join(' ')}
          aria-pressed={state.withGift}
          data-testid="orders-gift-quick-filter"
          onClick={() => {
            filtersApi.toggle('withGift');
          }}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="6" width="12" height="8" rx="1" />
            <path d="M1.5 4h13v2h-13zM8 4v10M8 4C6 4 4.5 3 5.5 2s2.5 1 2.5 2zM8 4c2 0 3.5-1 2.5-2S8 3 8 4z" />
          </svg>
          {giftCopy.filter.quick}
          {summary?.withGift !== undefined ? (
            <span className="gift-quick-filter__count">{summary.withGift}</span>
          ) : null}
        </button>
        <span className="list-toolbar__spacer" />
        <span className="text-muted mono tabular list-results" aria-live="polite">
          {resultCount === null
            ? null
            : plural(resultCount.value, resultCount.atLeast ? COPY.resultsAtLeast : COPY.results)}
        </span>
        <SortMenu
          options={sortOptions}
          value={filtersApi.sort}
          dir={filtersApi.dir}
          defaultKey={DEFAULT_ORDER_SORT}
          onChange={(key, dir) => {
            filtersApi.setSort(key, dir);
          }}
          aria-label={COPY.sortMenuAria}
        />
      </div>

      <ActiveFilterChips
        chips={activeChips}
        onClearAll={filtersApi.clearAll}
        onEmptyFocus={() => moreRef.current?.focus()}
        clearAllLabel={COPY.clearAll}
      />

      <SidePanel
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={COPY.allFiltersTitle}
        description={COPY.panelHint}
        width={420}
        className="filters-panel"
        closeIcon
        closeLabel={COPY.closeFilters}
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
              {resultCount === null
                ? COPY.showOrdersUnknown
                : plural(
                    resultCount.value,
                    resultCount.atLeast ? COPY.showOrdersAtLeast : COPY.showOrders,
                  )}
            </Button>
          </>
        }
      >
        <div className="filter-sections">
          {sheetSections.map(({ group, title, body }, index) => {
            const s = groupSummary(group);
            return (
              <FilterSection
                key={group}
                title={title}
                summary={s.text}
                active={s.active}
                defaultOpen={index === 0 || s.active}
              >
                {body}
              </FilterSection>
            );
          })}
        </div>
      </SidePanel>
    </div>
  );
}
