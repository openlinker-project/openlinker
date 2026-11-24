/**
 * ShipmentsFilterBar (#4044)
 *
 * The shipments list's toolbar on the orders system (#4026): one joined group
 * Processor / Method / Connection / Filters (`F`), the results count, the Sort
 * menu, the applied-filter pills and the Filters side panel (bottom sheet on
 * phones) with Tracking and Created. Status is not here: the tabs own it, so
 * it is neither a pill nor cleared by Clear all.
 *
 * Method stays visible when a Processor is set. A processor already picks the
 * method, so the dropdown says so instead of disappearing (it used to vanish).
 *
 * Every value lives in the URL; this component only renders and calls back.
 *
 * @module apps/web/src/pages/shipments
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { interpolate, useMessages, usePlural } from '../../shared/i18n';
import { ActiveFilterChips, type ActiveFilterChip } from '../../shared/ui/active-filter-chips';
import { Button } from '../../shared/ui/button';
import { FilterCheck, FilterChecks } from '../../shared/ui/filter-check';
import { FilterDropdown, FilterGroup } from '../../shared/ui/filter-dropdown';
import { FilterRange } from '../../shared/ui/filter-panel';
import { FilterSection } from '../../shared/ui/filter-sheet';
import { Input } from '../../shared/ui/input';
import { SidePanel } from '../../shared/ui/side-panel';
import { SortMenu, type SortMenuDir } from '../../shared/ui/sort-menu';
import {
  SHIPPING_METHOD_LABEL,
  SHIPPING_METHOD_VALUES,
  type ShippingMethod,
} from '../../features/shipments/api/shipments.types';
import {
  PROCESSOR_FILTER_VALUES,
  PROCESSOR_KIND_LABEL,
  type ProcessorFilter,
} from '../../features/shipments/lib/processor';

/** Sort menu entries; "Newest first" is the default. */
export type ShipmentSortKey = 'createdAt' | 'createdAtAsc' | 'status' | 'shippingMethod';

const SORT_MENU: readonly { key: ShipmentSortKey; dir: SortMenuDir }[] = [
  { key: 'createdAt', dir: 'desc' },
  { key: 'createdAtAsc', dir: 'asc' },
  { key: 'status', dir: 'asc' },
  { key: 'shippingMethod', dir: 'asc' },
];

export interface ShipmentsFilterBarProps {
  processor: ProcessorFilter | undefined;
  processorCounts: Readonly<Record<ProcessorFilter, number | undefined>>;
  onProcessorChange: (value: ProcessorFilter | null) => void;

  shippingMethod: ShippingMethod | undefined;
  methodCounts: Readonly<Record<ShippingMethod, number | undefined>>;
  onMethodChange: (value: ShippingMethod | null) => void;

  connections: readonly { id: string; name: string }[];
  connectionCounts: (id: string) => number | undefined;
  connectionId: string | undefined;
  onConnectionChange: (value: string | null) => void;

  hasTracking: boolean | undefined;
  onTrackingChange: (value: boolean | undefined) => void;
  waybillRelayStuck: boolean;
  onRelayChange: (on: boolean) => void;
  createdFrom: string | undefined;
  createdTo: string | undefined;
  onCreatedChange: (key: 'createdFrom' | 'createdTo', value: string) => void;

  /** `null` while unknown. */
  resultCount: number | null;
  sortKey: ShipmentSortKey;
  sortDir: SortMenuDir;
  onSortChange: (key: ShipmentSortKey, dir: SortMenuDir) => void;
  /** Clears every filter except status (the tabs own it). */
  onClearAll: () => void;
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

export function ShipmentsFilterBar(props: ShipmentsFilterBarProps): ReactElement {
  const {
    processor,
    processorCounts,
    onProcessorChange,
    shippingMethod,
    methodCounts,
    onMethodChange,
    connections,
    connectionCounts,
    connectionId,
    onConnectionChange,
    hasTracking,
    onTrackingChange,
    waybillRelayStuck,
    onRelayChange,
    createdFrom,
    createdTo,
    onCreatedChange,
    resultCount,
    sortKey,
    sortDir,
    onSortChange,
    onClearAll,
  } = props;
  const page = useMessages('shipments').shipmentsPage;
  const COPY = page.listFilters;
  const plural = usePlural();
  const filtersRef = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setSheetOpen((open) => !open);
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('keydown', onKeydown);
    };
  }, []);

  const connectionName = (id: string): string => connections.find((c) => c.id === id)?.name ?? id;
  const trackingLabel = (value: boolean): string =>
    value ? page.filters.withTracking : page.filters.withoutTracking;
  const createdText = [
    createdFrom ? interpolate(COPY.pills.createdFrom, { date: createdFrom }) : '',
    createdTo ? interpolate(COPY.pills.createdTo, { date: createdTo }) : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Pills, in the order the controls sit. Status is the tabs' job.
  const chips: ActiveFilterChip[] = [];
  const pill = (key: string, label: string, text: string, onRemove: () => void): void => {
    chips.push({ key, label, value: text, valueText: text, onRemove });
  };
  if (processor) pill('processor', COPY.pills.processor, PROCESSOR_KIND_LABEL[processor], () => { onProcessorChange(null); });
  if (shippingMethod) pill('method', COPY.pills.method, SHIPPING_METHOD_LABEL[shippingMethod], () => { onMethodChange(null); });
  if (connectionId) pill('connection', COPY.pills.connection, connectionName(connectionId), () => { onConnectionChange(null); });
  if (hasTracking !== undefined) pill('tracking', COPY.pills.tracking, trackingLabel(hasTracking), () => { onTrackingChange(undefined); });
  if (waybillRelayStuck) pill('relay', COPY.pills.relay, COPY.pills.relayValue, () => { onRelayChange(false); });
  if (createdText) {
    pill('created', COPY.pills.created, createdText, () => {
      onCreatedChange('createdFrom', '');
      onCreatedChange('createdTo', '');
    });
  }

  // Only what the joined group cannot show counts on the Filters button.
  const filtersCount = (hasTracking !== undefined ? 1 : 0) + (waybillRelayStuck ? 1 : 0) + (createdText ? 1 : 0);
  const trackingSummary = [hasTracking === undefined ? '' : trackingLabel(hasTracking), waybillRelayStuck ? COPY.pills.relayValue : '']
    .filter(Boolean)
    .join(', ');

  return (
    <div className="list-filters">
      <div className="list-toolbar">
        <FilterGroup aria-label={COPY.filterGroupAria}>
          <FilterDropdown<ProcessorFilter>
            label={COPY.processor}
            anyLabel={page.filters.allProcessors}
            value={processor ?? null}
            options={PROCESSOR_FILTER_VALUES.map((value) => ({
              value,
              label: PROCESSOR_KIND_LABEL[value],
              count: processorCounts[value],
            }))}
            onChange={onProcessorChange}
          />
          <FilterDropdown<ShippingMethod>
            label={COPY.method}
            anyLabel={page.filters.allMethods}
            value={shippingMethod ?? null}
            options={SHIPPING_METHOD_VALUES.map((value) => ({
              value,
              label: SHIPPING_METHOD_LABEL[value],
              count: methodCounts[value],
            }))}
            onChange={onMethodChange}
            disabledNote={processor ? COPY.methodLocked : undefined}
          />
          <FilterDropdown
            label={COPY.connection}
            anyLabel={page.filters.allConnections}
            value={connectionId ?? null}
            options={connections.map((c) => ({ value: c.id, label: c.name, count: connectionCounts(c.id) }))}
            onChange={onConnectionChange}
          />
          <button
            ref={filtersRef}
            type="button"
            className={['joined-filters__btn', filtersCount > 0 ? 'joined-filters__btn--on' : '']
              .filter(Boolean)
              .join(' ')}
            data-testid="shipments-filter-toggle"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            title={COPY.filtersTitle}
            onClick={() => {
              setSheetOpen(true);
            }}
          >
            <span aria-hidden="true">{'≡'}</span>
            {COPY.filters}
            {filtersCount > 0 ? <span className="button__count">{filtersCount}</span> : null}
            <span className="button__shortcut" aria-hidden="true">
              F
            </span>
          </button>
        </FilterGroup>
        <span className="list-toolbar__spacer" />
        <span className="text-muted mono tabular list-results" aria-live="polite">
          {resultCount === null ? null : plural(resultCount, COPY.results, { total: String(resultCount) })}
        </span>
        <SortMenu<ShipmentSortKey>
          options={SORT_MENU.map((o) => ({ key: o.key, label: COPY.sortMenu[o.key], dir: o.dir }))}
          value={sortKey}
          dir={sortDir}
          defaultKey="createdAt"
          onChange={onSortChange}
          aria-label={COPY.sortMenuAria}
        />
      </div>

      <ActiveFilterChips
        chips={chips}
        onClearAll={onClearAll}
        onEmptyFocus={() => filtersRef.current?.focus()}
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
            <Button tone="secondary" onClick={onClearAll}>
              {COPY.clearAll}
            </Button>
            <Button
              tone="primary"
              onClick={() => {
                setSheetOpen(false);
              }}
            >
              {resultCount === null ? COPY.showShipmentsUnknown : plural(resultCount, COPY.showShipments)}
            </Button>
          </>
        }
      >
        <div className="filter-sections">
          <FilterSection
            title={COPY.groups.tracking}
            summary={trackingSummary || COPY.sectionAny}
            active={trackingSummary !== ''}
            defaultOpen
          >
            <FilterChecks role="radiogroup" aria-label={COPY.groups.tracking}>
              <FilterCheck
                type="radio"
                name="shipments-tracking"
                label={page.filters.anyTracking}
                checked={hasTracking === undefined}
                onChange={() => { onTrackingChange(undefined); }}
              />
              <FilterCheck
                type="radio"
                name="shipments-tracking"
                label={page.filters.withTracking}
                checked={hasTracking === true}
                onChange={() => { onTrackingChange(true); }}
              />
              <FilterCheck
                type="radio"
                name="shipments-tracking"
                label={page.filters.withoutTracking}
                checked={hasTracking === false}
                onChange={() => { onTrackingChange(false); }}
              />
            </FilterChecks>
            <FilterChecks>
              <FilterCheck
                label={page.filters.relayStuck}
                checked={waybillRelayStuck}
                tone="error"
                onChange={() => { onRelayChange(!waybillRelayStuck); }}
              />
            </FilterChecks>
          </FilterSection>
          <FilterSection
            title={COPY.groups.created}
            summary={createdText || COPY.sectionAny}
            active={createdText !== ''}
            defaultOpen={createdText !== ''}
          >
            <FilterRange
              rows={[
                {
                  label: COPY.from,
                  control: (
                    <Input
                      type="date"
                      aria-label={page.filters.createdFrom}
                      value={createdFrom ?? ''}
                      onChange={(e) => { onCreatedChange('createdFrom', e.target.value); }}
                    />
                  ),
                },
                {
                  label: COPY.to,
                  control: (
                    <Input
                      type="date"
                      aria-label={page.filters.createdTo}
                      value={createdTo ?? ''}
                      onChange={(e) => { onCreatedChange('createdTo', e.target.value); }}
                    />
                  ),
                },
              ]}
            />
          </FilterSection>
        </div>
      </SidePanel>
    </div>
  );
}
