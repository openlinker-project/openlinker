/**
 * Bundle variant picker (#3935)
 *
 * Finds what goes into a bundle the way people look for it: a search box whose
 * results are pictures first. Every result is one VARIANT (a product with three
 * pack sizes is three rows under its name), with its attributes ("250 g,
 * ziarnista"), SKU, EAN, the stock OpenLinker would promise, what that stock
 * means for sets and the price, so nobody has to open a second page to be sure
 * it is the right one.
 *
 * It is a combobox: the input owns the focus, arrow keys move through the
 * options, Enter picks, Escape clears. A row that cannot be added (already in
 * the bundle, a bundle itself) is shown disabled WITH its reason up front, and
 * if someone still tries it the reason appears under the search instead of far
 * away. A product's variants are read only for the few results on screen and
 * the stock for all of them in one call once the variants have settled.
 *
 * @module apps/web/src/features/bundles/components
 */
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { formatPlural, interpolate, useFormat, useLocale, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { VariantThumbnail, type Product, type ProductVariant } from '../../products';
import { toBundleChoice, type BundleProductChoice } from '../lib/bundle-choice';
import { highlightMatch } from '../lib/highlight-match';
import { useComboboxNavigation } from '../lib/use-combobox-navigation';

const PAGE_SIZE = 6;
const LOW_STOCK = 5;
const SKELETON_ROWS = 3;
const BULK_LIMIT = 50;
const BULK_SEPARATOR = /[\n\r,;\t]+/;

/** The SKUs in a pasted block, in order, without blanks or repeats. */
export function splitSkuTokens(value: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of value.split(BULK_SEPARATOR)) {
    const token = raw.trim();
    if (token !== '' && !seen.has(token.toLowerCase())) {
      seen.add(token.toLowerCase());
      tokens.push(token);
    }
  }
  return tokens.slice(0, BULK_LIMIT);
}

export interface BundleVariantPickerProps {
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** Variants already chosen: listed, marked, not pickable again. */
  excludeVariantIds?: readonly string[];
  /** Variants that can never be picked here (the bundle's own product). */
  blockedVariantIds?: readonly string[];
  /** A product that is itself a bundle cannot be a component: show it disabled. */
  disallowBundles?: boolean;
  onPick: (choice: BundleProductChoice) => void;
  /**
   * Pasting (or entering) several SKUs separated by commas, semicolons or new lines adds every
   * exact match at once and reports what was not found. Off for a picker that takes one product.
   */
  multiPaste?: boolean;
  testIdPrefix: string;
  /** Lets the owner move focus here (the empty-list "search" button). */
  inputRef?: RefObject<HTMLInputElement | null>;
}

type RowReason = 'taken' | 'bundle' | 'blocked';

interface Option {
  id: string;
  disabled: boolean;
  product: Product;
  variant: ProductVariant;
  variantCount: number;
  reason: RowReason | null;
  sku: string | null;
  atp: number | null | undefined;
}

function attributeText(variant: ProductVariant): string {
  return variant.attributes ? Object.values(variant.attributes).join(', ') : '';
}

export function BundleVariantPicker({
  label,
  placeholder,
  disabled = false,
  excludeVariantIds = [],
  blockedVariantIds = [],
  disallowBundles = false,
  onPick,
  multiPaste = false,
  testIdPrefix,
  inputRef,
}: BundleVariantPickerProps): ReactElement {
  const copy = useMessages('bundles').picker;
  const apiClient = useApiClient();
  const format = useFormat();
  const { locale } = useLocale();
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const ownInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [rejection, setRejection] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ busy: boolean; text: string }>({ busy: false, text: '' });
  const search = useDebouncedValue(text.trim(), 250);
  const active = search.length >= 2;

  const results = useQuery({
    queryKey: ['bundles', 'product-search', search, limit],
    queryFn: () => apiClient.products.listRows({ search }, { limit, offset: 0 }),
    enabled: active,
    // Typing the next letter keeps the last list (dimmed) instead of blanking it.
    placeholderData: keepPreviousData,
  });
  const products = useMemo<Product[]>(() => (active ? (results.data?.items ?? []) : []), [active, results.data]);
  const maybeMore = active && products.length >= limit;

  // The total is only worth a request when the page came back full.
  const total = useQuery({
    queryKey: ['bundles', 'product-count', search],
    queryFn: () => apiClient.products.count({ search }),
    enabled: maybeMore,
    staleTime: 30_000,
  });

  const details = useQueries({
    queries: products.map((product) => ({
      queryKey: ['bundles', 'product-detail', product.id],
      queryFn: () => apiClient.products.getById(product.id),
      staleTime: 30_000,
    })),
  });
  // One availability call, after every detail settled: asking as each one
  // lands would fire a call per product with a growing id list.
  const detailsSettled = details.every((d) => !d.isPending);
  const variantIds = useMemo(
    () => details.flatMap((d) => (d.data?.variants ?? []).map((v) => v.id)),
    [details]
  );
  const stock = useQuery({
    queryKey: ['bundles', 'variant-stock', [...variantIds].sort().join(',')],
    queryFn: () => apiClient.inventory.availability(variantIds),
    enabled: detailsSettled && variantIds.length > 0,
    staleTime: 30_000,
  });
  const stockByVariant = new Map(
    (stock.data?.items ?? []).map((item) => [item.productVariantId, item.availableToPromise ?? null])
  );
  const stockPending = !detailsSettled || stock.isPending;

  const initialLoading = active && results.data === undefined && !results.isError;
  const refreshing = active && results.isFetching && results.data !== undefined && results.isPlaceholderData;

  const options: Option[] = [];
  products.forEach((product, index) => {
    const variants = details[index]?.data?.variants ?? [];
    for (const variant of variants) {
      const reason: RowReason | null = excludeVariantIds.includes(variant.id)
        ? 'taken'
        : blockedVariantIds.includes(variant.id)
          ? 'blocked'
          : disallowBundles && product.bundle?.variantId === variant.id
            ? 'bundle'
            : null;
      options.push({
        id: `${baseId}-opt-${variant.id}`,
        disabled: reason !== null,
        product,
        variant,
        variantCount: variants.length,
        reason,
        sku: variant.sku ?? product.sku,
        atp: stockPending ? undefined : (stockByVariant.get(variant.id) ?? null),
      });
    }
  });

  const nav = useComboboxNavigation(options);
  const activeId = nav.activeId;

  const [eanBefore = '', eanAfter = ''] = copy.ean.split('{ean}');
  const reasonText = (reason: RowReason): string =>
    reason === 'taken' ? copy.reasonTaken : reason === 'bundle' ? copy.reasonBundle : copy.reasonSelf;

  const focusInput = (): void => {
    (inputRef?.current ?? ownInputRef.current)?.focus();
  };

  const choose = (option: Option): void => {
    if (option.reason !== null) {
      setRejection(
        interpolate(copy.rejected, {
          name: option.product.name,
          reason: reasonText(option.reason),
        })
      );
      return;
    }
    onPick(toBundleChoice(option.product, option.variant, option.variantCount, option.atp ?? undefined));
    setAdded(interpolate(copy.added, { name: option.product.name }));
    setText('');
    setLimit(PAGE_SIZE);
    nav.reset();
    setRejection(null);
    // The owner's field array may focus the new row's first control in an effect
    // after this handler; taking the focus back one tick later is what keeps the
    // search ready for the next component.
    focusInput();
    window.setTimeout(focusInput, 0);
  };

  // Every token is resolved on its own, in order: an exact SKU (or EAN) of one variant, nothing fuzzy,
  // because a wrong guess here would put the wrong product into a bundle without anyone looking.
  const runBulk = async (tokens: string[]): Promise<void> => {
    setBulk({ busy: true, text: '' });
    setRejection(null);
    const found: { product: Product; variant: ProductVariant; count: number }[] = [];
    const taken = new Set<string>([...excludeVariantIds, ...blockedVariantIds]);
    const missing: string[] = [];
    let skipped = 0;
    for (const token of tokens) {
      const wanted = token.toLowerCase();
      let match: { product: Product; variant: ProductVariant; count: number } | null = null;
      try {
        const page = await apiClient.products.listRows({ search: token }, { limit: 5, offset: 0 });
        for (const item of page.items) {
          const detail = await apiClient.products.getById(item.id);
          const variants = detail.variants ?? [];
          const variant =
            variants.find((v) => (v.sku ?? '').toLowerCase() === wanted || (v.ean ?? '') === token) ??
            (variants.length === 1 && (detail.sku ?? '').toLowerCase() === wanted ? variants[0] : undefined);
          if (variant !== undefined) {
            match = { product: detail, variant, count: variants.length };
            break;
          }
        }
      } catch {
        match = null;
      }
      if (match === null || (disallowBundles && match.product.bundle?.variantId === match.variant.id)) {
        missing.push(token);
      } else if (taken.has(match.variant.id)) {
        skipped += 1;
      } else {
        taken.add(match.variant.id);
        found.push(match);
      }
    }
    let stockById = new Map<string, number | null>();
    if (found.length > 0) {
      try {
        const stockResult = await apiClient.inventory.availability(found.map((f) => f.variant.id));
        stockById = new Map(stockResult.items.map((item) => [item.productVariantId, item.availableToPromise ?? null]));
      } catch {
        // The rows still go in; their stock shows as unknown until the next read.
      }
    }
    for (const entry of found) {
      onPick(toBundleChoice(entry.product, entry.variant, entry.count, stockById.get(entry.variant.id) ?? undefined));
    }
    const parts = [interpolate(copy.bulkAdded, { n: found.length })];
    if (missing.length > 0) parts.push(interpolate(copy.bulkMissing, { n: missing.length, list: missing.join(', ') }));
    if (skipped > 0) parts.push(interpolate(copy.bulkSkipped, { n: skipped }));
    setBulk({ busy: false, text: parts.join(', ') });
    setText('');
    nav.reset();
    focusInput();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (multiPaste && event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      const tokens = splitSkuTokens(text);
      if (tokens.length > 1) {
        event.preventDefault();
        void runBulk(tokens);
        return;
      }
    }
    if (active && nav.onNavigationKey(event)) return;
    if (event.key === 'Enter') {
      // Only the row that is visibly highlighted: never an unseen first option.
      if (nav.activeOption !== null && active) {
        event.preventDefault();
        choose(nav.activeOption);
      }
    } else if (event.key === 'Escape') {
      if (text !== '' || rejection !== null) event.preventDefault();
      setText('');
      setLimit(PAGE_SIZE);
      nav.reset();
      setRejection(null);
    }
  };

  const settledCount = options.length;
  const status =
    added !== null
      ? added
      : active && !initialLoading && detailsSettled
        ? settledCount === 0
          ? interpolate(copy.noResultsTitle, { q: search })
          : formatPlural(settledCount, copy.resultsCount, locale)
        : '';
  const totalCount = total.data?.total;

  return (
    <div className="bundle-picker">
      <label className="form-field__label" htmlFor={inputId}>
        {label}
      </label>
      <Input
        id={inputId}
        ref={(node: HTMLInputElement | null) => {
          ownInputRef.current = node;
          if (inputRef !== undefined) inputRef.current = node;
        }}
        data-testid={testIdPrefix}
        type="search"
        role="combobox"
        aria-expanded={active && !results.isError}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId ?? undefined}
        autoComplete="off"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          if (!multiPaste) return;
          const tokens = splitSkuTokens(event.clipboardData.getData('text'));
          if (tokens.length < 2) return;
          // A type="search" input would swallow the line breaks of a pasted column.
          event.preventDefault();
          void runBulk(tokens);
        }}
        onChange={(event) => {
          setBulk({ busy: false, text: '' });
          setText(event.target.value);
          setLimit(PAGE_SIZE);
          nav.reset();
          setRejection(null);
          setAdded(null);
        }}
      />
      <div className="bpick__status sr-only" role="status" aria-live="polite" data-testid={`${testIdPrefix}-status`}>
        {status}
      </div>
      {rejection !== null ? (
        <p className="bpick__reject form-field__error" role="alert" data-testid={`${testIdPrefix}-rejection`}>
          {rejection}
        </p>
      ) : null}
      {bulk.busy ? (
        <p className="pm-help bpick__bulk" role="status">
          {copy.bulkBusy}
        </p>
      ) : bulk.text !== '' ? (
        <p className="bpick__bulk" role="status" data-testid={`${testIdPrefix}-bulk-result`}>
          {bulk.text}
        </p>
      ) : null}
      {!active ? (
        <p className="pm-help" data-testid={`${testIdPrefix}-hint`}>
          {text.trim().length === 1 ? copy.moreChars : multiPaste ? copy.hintMulti : copy.hint}
        </p>
      ) : null}
      {results.isError ? (
        <p className="form-field__error" role="alert">
          {copy.failed}
        </p>
      ) : null}
      {initialLoading ? (
        <ul className="bpick bpick--loading" aria-hidden="true" data-testid={`${testIdPrefix}-loading`}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <li key={i} className="bpick__group">
              <span className="bpick__srow">
                <span className="bpick__skel bpick__skel--thumb" />
                <span className="bpick__skel-main">
                  <span className="bpick__skel bpick__skel--l1" />
                  <span className="bpick__skel bpick__skel--l2" />
                </span>
                <span className="bpick__skel-side">
                  <span className="bpick__skel bpick__skel--s1" />
                  <span className="bpick__skel bpick__skel--s2" />
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {active && !initialLoading && !results.isError && products.length === 0 ? (
        <div className="bpick__empty" data-testid={`${testIdPrefix}-empty`}>
          <p className="bpick__empty-t">{interpolate(copy.noResultsTitle, { q: search })}</p>
          <p className="bpick__empty-d">{copy.noResultsBody}</p>
        </div>
      ) : null}
      <ul
        id={listId}
        className={`bpick${refreshing ? ' is-refreshing' : ''}`}
        role="listbox"
        aria-label={copy.listLabel}
        aria-busy={initialLoading || refreshing || !detailsSettled}
        hidden={products.length === 0}
      >
        {products.map((product, index) => {
          const query = details[index];
          const variants = query?.data?.variants ?? [];
          if (query?.isError === true) {
            return (
              <li key={product.id} role="presentation" className="bpick__group bpick__group--failed">
                <span>{interpolate(copy.productFailed, { name: product.name })}</span>
                <Button
                  tone="ghost"
                  className="button--sm"
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  {copy.retry}
                </Button>
              </li>
            );
          }
          if (variants.length === 0) {
            return (
              <li key={product.id} role="presentation" className="bpick__group bpick__group--loading">
                <span className="bpick__srow">
                  <span className="bpick__skel bpick__skel--thumb" />
                  <span className="bpick__skel-main">
                    <span className="bpick__skel-name">{product.name}</span>
                    <span className="bpick__skel bpick__skel--l2" />
                  </span>
                  <span className="bpick__skel-side">
                    <span className="bpick__skel bpick__skel--s1" />
                    <span className="bpick__skel bpick__skel--s2" />
                  </span>
                </span>
              </li>
            );
          }
          return (
            <li key={product.id} role="presentation" className="bpick__group">
              {variants.length > 1 ? <p className="bpick__product">{product.name}</p> : null}
              <ul role="group" aria-label={product.name}>
                {options
                  .filter((o) => o.product.id === product.id)
                  .map((option) => {
                    const { variant, reason, atp, sku } = option;
                    const price = variant.price ?? product.price;
                    const attrs = attributeText(variant);
                    const multi = option.variantCount > 1;
                    const title = multi && attrs !== '' ? attrs : product.name;
                    const isActive = option.id === activeId;
                    const stockClass =
                      atp === 0 ? ' is-out' : atp !== null && atp !== undefined && atp < LOW_STOCK ? ' is-low' : '';
                    return (
                      <li
                        key={variant.id}
                        id={option.id}
                        role="option"
                        aria-selected={isActive}
                        aria-disabled={disabled || reason !== null}
                        className={`bpick__row${isActive ? ' is-active' : ''}${reason !== null ? ' is-disabled' : ''}`}
                        data-testid={`${testIdPrefix}-result-${sku ?? variant.id}`}
                        onMouseMove={() => {
                          if (!isActive) nav.hover(option);
                        }}
                        onMouseDown={(event) => {
                          // Keep the focus in the input so the next key still works.
                          event.preventDefault();
                        }}
                        onClick={() => {
                          if (!disabled) choose(option);
                        }}
                      >
                        <VariantThumbnail src={variant.imageUrls?.[0]} name={product.name} size="md" />
                        <span className="bpick__main">
                          {multi && attrs !== '' ? (
                            <span className="bpick__parent">{highlightMatch(product.name, search)}</span>
                          ) : null}
                          <span className="bpick__name">{highlightMatch(title, search)}</span>
                          {multi && attrs !== '' ? (
                            <span className="bpick__variant">
                              {interpolate(copy.variant, { attrs })}
                            </span>
                          ) : null}
                          {multi && attrs === '' ? <span className="bpick__attrs">{product.name}</span> : null}
                          <span className="bpick__codes mono">
                            {sku !== null ? <span>{highlightMatch(sku, search)}</span> : null}
                            {variant.ean !== null ? (
                              <span>
                                {eanBefore}
                                {highlightMatch(variant.ean, search)}
                                {eanAfter}
                              </span>
                            ) : null}
                          </span>
                          {reason !== null ? (
                            <span className="bpick__why" data-testid={`${testIdPrefix}-why-${sku ?? variant.id}`}>
                              {reasonText(reason)}
                            </span>
                          ) : null}
                        </span>
                        <span className="bpick__side">
                          {atp === undefined ? (
                            <span className="bpick__skel bpick__skel--s1" aria-hidden="true" />
                          ) : (
                            <span className={`bpick__stock${stockClass}`}>
                              {atp === null
                                ? copy.stockUnknown
                                : atp === 0
                                  ? copy.stockOut
                                  : interpolate(copy.stock, { n: atp })}
                            </span>
                          )}
                          {atp !== undefined && atp !== null ? (
                            <span className="bpick__sets">{interpolate(copy.asOne, { n: atp })}</span>
                          ) : null}
                          {price !== null ? (
                            <span className="bpick__price mono tabular">
                              {format.money(price, product.currency ?? undefined)}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </li>
          );
        })}
      </ul>
      {maybeMore && !initialLoading ? (
        <div className="bpick__more">
          <span className="bpick__more-note">
            {totalCount !== undefined
              ? interpolate(copy.showing, { shown: products.length, total: totalCount })
              : interpolate(copy.showingSome, { shown: products.length })}
          </span>
          {totalCount === undefined || totalCount > products.length ? (
            <Button
              tone="ghost"
              className="button--sm"
              data-testid={`${testIdPrefix}-more`}
              disabled={results.isFetching}
              onClick={() => {
                setLimit((current) => current + PAGE_SIZE);
              }}
            >
              {copy.showMore}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
