/**
 * ProductsFilterBar (#4027)
 *
 * The products list's toolbar on the same system as the orders list (#4026):
 * search (`/`), one joined group Source / Listings / Tax rate / Filters (`F`),
 * the results count, the Sort menu, the applied-filter pills and the Filters
 * side panel (bottom sheet on phones). Stock is not here: the status tabs own
 * it, so it is neither a pill nor cleared by Clear all.
 *
 * Every value lives in the URL; this component only renders and calls back.
 *
 * @module apps/web/src/pages/products
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { interpolate, useMessages, usePlural } from '../../shared/i18n';
import { ActiveFilterChips, type ActiveFilterChip } from '../../shared/ui/active-filter-chips';
import { Button } from '../../shared/ui/button';
import { FilterCheck, FilterChecks } from '../../shared/ui/filter-check';
import { FilterDropdown, FilterGroup } from '../../shared/ui/filter-dropdown';
import { FilterSection } from '../../shared/ui/filter-sheet';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { SidePanel } from '../../shared/ui/side-panel';
import { SortMenu } from '../../shared/ui/sort-menu';
import type {
  ProductListSortDir,
  ProductListSortField,
  ProductStockFilter,
} from '../../features/products/api/products.types';
import type { ProductGapConnection } from '../../features/products/components/product-attention-summary';

/** Sort menu entries in menu order; `createdAt` (newest first) is the default. */
const SORT_KEYS: readonly ProductListSortField[] = ['createdAt', 'updatedAt', 'name', 'sku', 'price', 'stock'];

export type ProductTaxFilter = 'missing' | 'not-checked';

export interface ProductsFilterBarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;

  sources: readonly { id: string; name: string }[];
  sourceCounts: Readonly<Record<string, number | undefined>>;
  sourceConnectionId: string | undefined;
  onSourceChange: (id: string | null) => void;

  allGapsValue: string;
  gapsCount: number | undefined;
  gapConnections: readonly ProductGapConnection[];
  unlistedOn: string;
  onUnlistedOnChange: (value: string) => void;

  showTax: boolean;
  taxRateState: 'missing' | 'not-checked' | 'known' | undefined;
  taxMissingCount: number | undefined;
  taxNotCheckedCount: number | undefined;
  onTaxRateStateChange: (value: ProductTaxFilter | null) => void;

  stock: ProductStockFilter | undefined;
  stockCounts: Readonly<Record<'all' | ProductStockFilter, number | undefined>>;
  onStockChange: (value: ProductStockFilter | null) => void;

  hideStale: boolean;
  staleCount: number | undefined;
  onHideStaleChange: (value: boolean) => void;

  /** Exact total, or a floor while the total is still counted; `null` while unknown. */
  resultCount: { value: number; atLeast: boolean } | null;
  sort: ProductListSortField;
  dir: ProductListSortDir;
  defaultDir: Readonly<Record<ProductListSortField, ProductListSortDir>>;
  onSortChange: (field: ProductListSortField, dir: ProductListSortDir) => void;
  /** Clears every filter except stock (the tabs own it). */
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

export function ProductsFilterBar(props: ProductsFilterBarProps): ReactElement {
  const {
    searchInput,
    onSearchChange,
    sources,
    sourceCounts,
    sourceConnectionId,
    onSourceChange,
    allGapsValue,
    gapsCount,
    gapConnections,
    unlistedOn,
    onUnlistedOnChange,
    showTax,
    taxRateState,
    taxMissingCount,
    taxNotCheckedCount,
    onTaxRateStateChange,
    stock,
    stockCounts,
    onStockChange,
    hideStale,
    staleCount,
    onHideStaleChange,
    resultCount,
    sort,
    dir,
    defaultDir,
    onSortChange,
    onClearAll,
  } = props;
  const page = useMessages('products').productsListPage;
  const COPY = page.listFilters;
  const plural = usePlural();
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const sourceName = (id: string): string => sources.find((s) => s.id === id)?.name ?? id;
  const gapName = (value: string): string =>
    value === allGapsValue
      ? COPY.pills.anyMarketplace
      : (gapConnections.find((c) => c.id === value)?.name ?? value);
  const taxValue = taxRateState === 'missing' || taxRateState === 'not-checked' ? taxRateState : null;
  const taxLabel = (value: ProductTaxFilter): string =>
    value === 'missing' ? COPY.tax.missing : COPY.tax.notChecked;

  // Pills, in the order the controls sit. Stock is the tabs' job.
  const chips: ActiveFilterChip[] = [];
  if (searchInput) {
    const text = `“${searchInput}”`;
    chips.push({ key: 'search', label: COPY.pills.search, value: text, valueText: text, onRemove: () => { onSearchChange(''); } });
  }
  if (sourceConnectionId) {
    const text = sourceName(sourceConnectionId);
    chips.push({ key: 'source', label: COPY.pills.source, value: text, valueText: text, onRemove: () => { onSourceChange(null); } });
  }
  if (unlistedOn) {
    const text = gapName(unlistedOn);
    chips.push({ key: 'unlistedOn', label: COPY.pills.unlistedOn, value: text, valueText: text, onRemove: () => { onUnlistedOnChange(''); } });
  }
  if (taxValue) {
    const text = taxLabel(taxValue);
    chips.push({ key: 'tax', label: COPY.pills.taxRate, value: text, valueText: text, onRemove: () => { onTaxRateStateChange(null); } });
  }
  if (hideStale) {
    chips.push({
      key: 'hideStale',
      label: COPY.pills.deleted,
      value: COPY.pills.hidden,
      valueText: COPY.pills.hidden,
      onRemove: () => { onHideStaleChange(false); },
    });
  }
  // Only what the joined group cannot show counts on the Filters button.
  const filtersCount = hideStale ? 1 : 0;

  const listingOptions = [
    { value: allGapsValue, label: COPY.unlistedAnywhere, count: gapsCount },
    ...gapConnections.map((c) => ({
      value: c.id,
      label: interpolate(page.filters.unlistedOn, { name: c.platform }),
      count: c.count,
    })),
  ];

  const summary = (value: string | null, none: string = COPY.sectionAny): { text: string; active: boolean } =>
    value ? { text: value, active: true } : { text: none, active: false };

  const sections: { id: string; title: string; summary: { text: string; active: boolean }; body: ReactNode }[] = [
    {
      id: 'stock',
      title: COPY.groups.stock,
      summary: summary(stock ? page.filters.stockChips[stock] : null),
      body: (
        <FilterChecks role="radiogroup" aria-label={COPY.groups.stock}>
          <FilterCheck
            type="radio"
            name="products-stock"
            label={COPY.anyStock}
            checked={!stock}
            count={stockCounts.all}
            onChange={() => { onStockChange(null); }}
          />
          {(['out', 'low', 'oversold'] as const).map((value) => (
            <FilterCheck
              key={value}
              type="radio"
              name="products-stock"
              label={page.filters.stockChips[value]}
              checked={stock === value}
              count={stockCounts[value]}
              tone={value === 'low' ? 'warning' : 'error'}
              onChange={() => { onStockChange(value); }}
            />
          ))}
        </FilterChecks>
      ),
    },
    {
      id: 'source',
      title: COPY.groups.source,
      summary: summary(sourceConnectionId ? sourceName(sourceConnectionId) : null),
      body: (
        <Select
          aria-label={page.filters.sourceLabel}
          value={sourceConnectionId ?? ''}
          onChange={(e) => {
            onSourceChange(e.target.value || null);
          }}
        >
          <option value="">{COPY.allConnections}</option>
          {sources.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      ),
    },
  ];
  if (gapConnections.length > 0) {
    sections.push({
      id: 'listings',
      title: COPY.groups.listings,
      summary: summary(unlistedOn ? gapName(unlistedOn) : null),
      body: (
        <FilterChecks role="radiogroup" aria-label={COPY.groups.listings}>
          <FilterCheck
            type="radio"
            name="products-gap"
            label={COPY.anyListing}
            checked={!unlistedOn}
            onChange={() => { onUnlistedOnChange(''); }}
          />
          <FilterCheck
            type="radio"
            name="products-gap"
            label={COPY.unlistedAnyMarketplace}
            checked={unlistedOn === allGapsValue}
            count={gapsCount}
            tone="warning"
            onChange={() => { onUnlistedOnChange(allGapsValue); }}
          />
          {gapConnections.map((c) => (
            <FilterCheck
              key={c.id}
              type="radio"
              name="products-gap"
              label={interpolate(page.filters.unlistedOn, { name: c.name })}
              checked={unlistedOn === c.id}
              count={c.count}
              tone="warning"
              onChange={() => { onUnlistedOnChange(c.id); }}
            />
          ))}
        </FilterChecks>
      ),
    });
  }
  if (showTax) {
    sections.push({
      id: 'tax',
      title: COPY.groups.taxRate,
      summary: summary(taxValue ? taxLabel(taxValue) : null),
      body: (
        <FilterChecks role="radiogroup" aria-label={COPY.groups.taxRate}>
          <FilterCheck
            type="radio"
            name="products-tax"
            label={COPY.anyTax}
            checked={!taxValue}
            onChange={() => { onTaxRateStateChange(null); }}
          />
          <FilterCheck
            type="radio"
            name="products-tax"
            label={COPY.tax.missing}
            checked={taxValue === 'missing'}
            count={taxMissingCount}
            tone="error"
            onChange={() => { onTaxRateStateChange('missing'); }}
          />
          <FilterCheck
            type="radio"
            name="products-tax"
            label={COPY.tax.notChecked}
            checked={taxValue === 'not-checked'}
            count={taxNotCheckedCount}
            onChange={() => { onTaxRateStateChange('not-checked'); }}
          />
        </FilterChecks>
      ),
    });
  }
  sections.push({
    id: 'deleted',
    title: COPY.groups.deleted,
    summary: summary(hideStale ? COPY.pills.hidden : null, COPY.sectionShown),
    body: (
      <FilterChecks>
        <FilterCheck
          label={COPY.hideDeleted}
          checked={hideStale}
          count={staleCount}
          onChange={() => { onHideStaleChange(!hideStale); }}
        />
      </FilterChecks>
    ),
  });

  const showLabel =
    resultCount === null
      ? COPY.showProductsUnknown
      : plural(resultCount.value, resultCount.atLeast ? COPY.showProductsAtLeast : COPY.showProducts);

  return (
    <div className="list-filters">
      <div className="list-toolbar">
        <div className="list-search">
          <span className="list-search__glyph" aria-hidden="true">
            ⌕
          </span>
          <Input
            ref={searchRef}
            type="search"
            aria-label={page.filters.searchLabel}
            data-testid="stock-list-search"
            placeholder={page.filters.searchPlaceholder}
            value={searchInput}
            onChange={(e) => {
              onSearchChange(e.target.value);
            }}
          />
          <span className="button__shortcut list-search__kbd" aria-hidden="true">
            /
          </span>
        </div>
        <FilterGroup aria-label={COPY.filterGroupAria}>
          <FilterDropdown
            label={COPY.groups.source}
            anyLabel={COPY.allConnections}
            value={sourceConnectionId ?? null}
            options={sources.map((c) => ({ value: c.id, label: c.name, count: sourceCounts[c.id] }))}
            onChange={onSourceChange}
          />
          {gapConnections.length > 0 ? (
            <FilterDropdown
              label={COPY.groups.listings}
              anyLabel={COPY.anyListing}
              value={unlistedOn || null}
              options={listingOptions}
              onChange={(next) => {
                onUnlistedOnChange(next ?? '');
              }}
            />
          ) : null}
          {showTax ? (
            <FilterDropdown<ProductTaxFilter>
              label={COPY.groups.taxRate}
              anyLabel={COPY.anyTax}
              value={taxValue}
              options={[
                { value: 'missing', label: COPY.tax.missing, count: taxMissingCount },
                { value: 'not-checked', label: COPY.tax.notChecked, count: taxNotCheckedCount },
              ]}
              onChange={onTaxRateStateChange}
            />
          ) : null}
          <button
            ref={filtersRef}
            type="button"
            className={['joined-filters__btn', filtersCount > 0 ? 'joined-filters__btn--on' : '']
              .filter(Boolean)
              .join(' ')}
            data-testid="products-filter-toggle"
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
          {resultCount === null
            ? null
            : plural(resultCount.value, page.filters.results, {
                total: `${resultCount.value}${resultCount.atLeast ? '+' : ''}`,
              })}
        </span>
        <SortMenu
          options={SORT_KEYS.map((key) => ({ key, label: COPY.sortMenu[key], dir: defaultDir[key] }))}
          value={sort}
          dir={dir}
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
              {showLabel}
            </Button>
          </>
        }
      >
        <div className="filter-sections">
          {sections.map((section, index) => (
            <FilterSection
              key={section.id}
              title={section.title}
              summary={section.summary.text}
              active={section.summary.active}
              defaultOpen={index === 0 || section.summary.active}
            >
              {section.body}
            </FilterSection>
          ))}
        </div>
      </SidePanel>
    </div>
  );
}
