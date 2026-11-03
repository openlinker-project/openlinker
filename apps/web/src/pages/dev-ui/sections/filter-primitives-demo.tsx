/**
 * Filter primitives demo (#3507)
 *
 * A live, stateful example of the shared filter kit — the same composition the
 * orders list uses (mockup m4b-orders-filters): search + "Filters (n)" + count,
 * active chips with "Clear all", the accordion panel, the quick-filter row,
 * and the phone bottom sheet. State is local to the demo; a real page writes
 * every value to the URL instead.
 *
 * @module pages/dev-ui/sections
 */
import { useState, type ReactElement } from 'react';
import {
  ActiveFilterChips,
  BareIconButton,
  Button,
  Chip,
  FilterCheck,
  FilterChecks,
  FilterField,
  FilterGroup,
  FilterPanel,
  FilterPanelFooter,
  FilterRange,
  FilterSection,
  FilterSheet,
  FilterToggleButton,
  Input,
  QuickFilters,
  QuickFiltersLabel,
  QuickFiltersSeparator,
  SegmentedControl,
  Select,
  type ActiveFilterChip,
} from '../../../shared/ui';

type Sla = 'any' | 'overdue' | 'at_risk' | 'on_track';

const SLA_LABEL: Record<Sla, string> = {
  any: 'Any',
  overdue: 'Overdue',
  at_risk: 'At risk',
  on_track: 'On track',
};

export function FilterPrimitivesDemo(): ReactElement {
  const [open, setOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [source, setSource] = useState('Allegro – Sklep główny');
  const [fulfillment, setFulfillment] = useState('Not shipped');
  const [sla, setSla] = useState<Sla>('any');
  const [blocked, setBlocked] = useState(false);
  const [conflict, setConflict] = useState(true);
  const [ready, setReady] = useState(false);

  const chip = (key: string, label: string, value: string, onRemove: () => void): ActiveFilterChip => ({
    key,
    label,
    value,
    valueText: value,
    onRemove,
  });
  const chips: ActiveFilterChip[] = [];
  if (source) chips.push(chip('source', 'Source', source, () => setSource('')));
  if (fulfillment) chips.push(chip('fulfillment', 'Fulfillment', fulfillment, () => setFulfillment('')));
  if (sla !== 'any') chips.push(chip('sla', 'Ship-by', SLA_LABEL[sla], () => setSla('any')));
  if (blocked) chips.push(chip('blocked', 'Sales documents', 'Blocked', () => setBlocked(false)));
  if (conflict) chips.push(chip('conflict', 'Tax rate', 'Conflict', () => setConflict(false)));

  const clearAll = (): void => {
    setSource('');
    setFulfillment('');
    setSla('any');
    setBlocked(false);
    setConflict(false);
  };

  const groups = (
    <>
      <FilterGroup legend="Source & dates">
        <FilterField label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            <option>Allegro – Sklep główny</option>
            <option>PrestaShop</option>
          </Select>
        </FilterField>
        <FilterField label="Created" as="div">
          <FilterRange
            rows={[
              { label: 'From', control: <input type="date" className="control" aria-label="Created from" /> },
              { label: 'To', control: <input type="date" className="control" aria-label="Created to" /> },
            ]}
          />
        </FilterField>
      </FilterGroup>
      <FilterGroup legend="Shipment">
        <FilterField label="Fulfillment">
          <Select value={fulfillment} onChange={(e) => setFulfillment(e.target.value)}>
            <option value="">Any fulfillment</option>
            <option>Not shipped</option>
            <option>Dispatched</option>
          </Select>
        </FilterField>
        <FilterField label="Ship-by" as="div">
          <SegmentedControl<Sla>
            aria-label="Ship-by"
            value={sla}
            onChange={setSla}
            options={(Object.keys(SLA_LABEL) as Sla[]).map((value) => ({ value, label: SLA_LABEL[value] }))}
          />
        </FilterField>
      </FilterGroup>
      <FilterGroup legend="Exceptions">
        <FilterChecks>
          <FilterCheck label="Sales documents blocked" tone="error" count={30} checked={blocked} onChange={() => setBlocked(!blocked)} />
          <FilterCheck label="Rate conflict" count={1} checked={conflict} onChange={() => setConflict(!conflict)} />
          <FilterCheck label="Open return" onChange={() => {}} />
        </FilterChecks>
      </FilterGroup>
      <FilterGroup legend="Tags">
        <FilterChecks role="radiogroup" aria-label="Tag">
          <FilterCheck type="radio" name="demo-tag" label="Any tag" defaultChecked />
          <FilterCheck type="radio" name="demo-tag" label="No tags" mutedLabel count={348} />
        </FilterChecks>
      </FilterGroup>
    </>
  );

  return (
    <div className="ds-stack">
      <div className="orders-filterbar">
        <div className="orders-filterbar__search">
          <span className="orders-filterbar__search-glyph" aria-hidden="true">⌕</span>
          <Input type="search" aria-label="Search" placeholder="Search by order number, SKU or tracking number…" />
          <span className="button__shortcut orders-filterbar__kbd" aria-hidden="true">/</span>
        </div>
        <FilterToggleButton expanded={open} count={chips.length} controls="demo-filter-panel" onClick={() => setOpen(!open)} />
        <Button tone="ghost" className="button--sm" onClick={() => setSheetOpen(true)}>
          Open as phone sheet
        </Button>
        <span className="text-muted mono tabular orders-filterbar__count">69 results</span>
      </div>
      {open ? null : <ActiveFilterChips chips={chips} onClearAll={clearAll} />}
      {open ? (
        <FilterPanel
          id="demo-filter-panel"
          footer={
            <FilterPanelFooter
              actions={
                <>
                  <Button tone="ghost" className="button--sm" onClick={clearAll}>Clear all</Button>
                  <Button tone="ghost" className="button--sm" onClick={() => setOpen(false)}>Hide filters</Button>
                </>
              }
            />
          }
        >
          {groups}
        </FilterPanel>
      ) : null}
      <QuickFilters aria-label="Quick filters" end={<a className="nav-link" href="#dispatch-risk">Dispatch risk</a>}>
        <QuickFiltersLabel>Needs a look</QuickFiltersLabel>
        <Chip tone="warning">Ship-by ≤ 24h</Chip>
        <Chip tone="error" active={blocked} onClick={() => setBlocked(!blocked)}>
          Sales docs blocked <span className="chip__count">30 · oldest 28 d</span>
        </Chip>
        <QuickFiltersSeparator />
        <QuickFiltersLabel>Phase</QuickFiltersLabel>
        <Chip active={ready} onClick={() => setReady(!ready)}>
          Ready <span className="chip__count">183</span>
        </Chip>
      </QuickFilters>
      <div className="ds-row">
        <span className="order-tag" data-tag-color="violet">
          <span className="order-tag__dot" aria-hidden="true" />
          <span className="order-tag__label">VIP</span>
          <BareIconButton className="order-tag__remove" label="Remove tag VIP" />
        </span>
        <span className="text-muted">BareIconButton keeps a 22 px pill at 22 px.</span>
      </div>
      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        footer={
          <>
            <Button tone="secondary" onClick={clearAll}>Clear all</Button>
            <Button tone="primary" onClick={() => setSheetOpen(false)}>Show 69 orders</Button>
          </>
        }
      >
        <FilterSection title="Source & dates" summary={source || 'Any'} active={Boolean(source)} defaultOpen>
          <span className="text-muted">Section body</span>
        </FilterSection>
        <FilterSection title="Shipment" summary={fulfillment || 'Any'} active={Boolean(fulfillment)}>
          <span className="text-muted">Section body</span>
        </FilterSection>
      </FilterSheet>
    </div>
  );
}
