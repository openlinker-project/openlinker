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

const PAGE_SIZE = 6;
const LOW_STOCK = 5;
const SKELETON_ROWS = 3;

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
  testIdPrefix: string;
  /** Lets the owner move focus here (the empty-list "search" button). */
  inputRef?: RefObject<HTMLInputElement | null>;
}

type RowReason = 'taken' | 'bundle' | 'blocked';

interface Option {
  id: string;
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
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
        product,
        variant,
        variantCount: variants.length,
        reason,
        sku: variant.sku ?? product.sku,
        atp: stockPending ? undefined : (stockByVariant.get(variant.id) ?? null),
      });
    }
  });

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
    setActiveId(null);
    setRejection(null);
    // The owner's field array may focus the new row's first control in an effect
    // after this handler; taking the focus back one tick later is what keeps the
    // search ready for the next component.
    focusInput();
    window.setTimeout(focusInput, 0);
  };

  const move = (step: 1 | -1 | 'first' | 'last'): void => {
    if (options.length === 0) return;
    const current = options.findIndex((o) => o.id === activeId);
    const next =
      step === 'first'
        ? 0
        : step === 'last'
          ? options.length - 1
          : current === -1
            ? step === 1
              ? 0
              : options.length - 1
            : (current + step + options.length) % options.length;
    const option = options[next];
    if (option === undefined) return;
    setActiveId(option.id);
    document.getElementById(option.id)?.scrollIntoView?.({ block: 'nearest' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      const option = options.find((o) => o.id === activeId) ?? options[0];
      if (option !== undefined && active) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === 'Escape') {
      if (text !== '' || rejection !== null) event.preventDefault();
      setText('');
      setLimit(PAGE_SIZE);
      setActiveId(null);
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
        aria-expanded={active && products.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId ?? undefined}
        autoComplete="off"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setText(event.target.value);
          setLimit(PAGE_SIZE);
          setActiveId(null);
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
      {!active ? <p className="pm-help">{copy.hint}</p> : null}
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
                        title={reason !== null ? reasonText(reason) : undefined}
                        onMouseMove={() => {
                          if (!isActive) setActiveId(option.id);
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
                            <span className="bpick__parent">{product.name}</span>
                          ) : null}
                          <span className="bpick__name">{title}</span>
                          {multi && attrs !== '' ? (
                            <span className="bpick__variant">
                              {interpolate(copy.variant, { attrs })}
                            </span>
                          ) : null}
                          {multi && attrs === '' ? <span className="bpick__attrs">{product.name}</span> : null}
                          <span className="bpick__codes mono">
                            {sku !== null ? <span>{sku}</span> : null}
                            {variant.ean !== null ? <span>{interpolate(copy.ean, { ean: variant.ean })}</span> : null}
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
