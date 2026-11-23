/**
 * Bundle product picker (#3624)
 *
 * One search box that finds a product by name or SKU and hands back the
 * variant the operator means. A product with a single variant is picked in one
 * click; one with several asks which variant, because a bundle and its
 * components are variants and guessing one would put the wrong stock in a set.
 *
 * Same combobox as the component picker (#3935): arrows skip rows that cannot
 * be chosen, the first enabled row is highlighted so Enter's target is visible,
 * the matched text is marked and the result count is announced.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { formatPlural, interpolate, useLocale, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { toBundleChoice, variantLabel, type BundleProductChoice } from '../lib/bundle-choice';
import { highlightMatch } from '../lib/highlight-match';
import { useComboboxNavigation } from '../lib/use-combobox-navigation';
import type { Product } from '../../products';

export interface BundleProductPickerProps {
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** Variants that are already chosen; they are listed but cannot be picked again. */
  excludeVariantIds?: readonly string[];
  /** A product that is itself a bundle is shown disabled with the reason. */
  disallowBundles?: boolean;
  onPick: (choice: BundleProductChoice) => void;
  testIdPrefix: string;
}

interface ProductOption {
  id: string;
  disabled: boolean;
  product: Product;
}

export function BundleProductPicker({
  label,
  placeholder,
  disabled = false,
  excludeVariantIds = [],
  disallowBundles = false,
  onPick,
  testIdPrefix,
}: BundleProductPickerProps): ReactElement {
  const bundlesCopy = useMessages('bundles');
  const copy = bundlesCopy.picker;
  const formCopy = bundlesCopy.form;
  const { locale } = useLocale();
  const apiClient = useApiClient();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState<Product | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const search = useDebouncedValue(text.trim(), 250);
  const active = search.length >= 2 && text.trim().length >= 2;
  // Rows belong to an older query until the debounce settles: Enter and clicks must wait.
  const stale = text.trim() !== search;

  const results = useQuery({
    queryKey: ['bundles', 'product-search', search],
    queryFn: () => apiClient.products.listRows({ search }, { limit: 8, offset: 0 }),
    enabled: active,
  });

  const variants = useQuery({
    queryKey: ['bundles', 'product-variants', expanded?.id ?? ''],
    queryFn: () => apiClient.products.getById(expanded?.id ?? ''),
    enabled: expanded !== null,
  });

  const items = useMemo<Product[]>(() => (active ? (results.data?.items ?? []) : []), [active, results.data]);
  // Choosable products first (stable), so a greyed bundle never pushes the first usable row down.
  const options: ProductOption[] = items
    .map((product) => ({
      id: `${baseId}-opt-${product.id}`,
      disabled: disallowBundles && product.bundle != null,
      product,
    }))
    .sort((a, b) => Number(a.disabled) - Number(b.disabled));
  const nav = useComboboxNavigation(options);

  const [chooseFailed, setChooseFailed] = useState(false);
  const choose = async (option: ProductOption): Promise<void> => {
    const { product } = option;
    if (stale) return;
    if (option.disabled) {
      setRejection(interpolate(copy.rejected, { name: product.name, reason: copy.reasonBundle }));
      return;
    }
    setRejection(null);
    setChooseFailed(false);
    let detail: Awaited<ReturnType<typeof apiClient.products.getById>>;
    try {
      detail = await apiClient.products.getById(product.id);
    } catch {
      setChooseFailed(true);
      return;
    }
    const list = detail.variants ?? [];
    if (list.length === 1) {
      onPick(toBundleChoice(product, list[0], 1));
      setText('');
      setExpanded(null);
      nav.reset();
      inputRef.current?.focus();
      return;
    }
    setExpanded(product);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (active && nav.onNavigationKey(event)) return;
    if (event.key === 'Enter') {
      // Only the row that is visibly highlighted: never an unseen first option.
      if (nav.activeOption !== null && active) {
        event.preventDefault();
        void choose(nav.activeOption);
      }
    } else if (event.key === 'Escape') {
      if (text !== '' || rejection !== null) event.preventDefault();
      setText('');
      setExpanded(null);
      setRejection(null);
      nav.reset();
    }
  };

  const settled = active && results.data !== undefined && !results.isFetching;
  const status = !active
    ? ''
    : results.isFetching
      ? formCopy.s2SearchLoading
      : results.data !== undefined
        ? items.length === 0
          ? interpolate(copy.noResultsTitle, { q: search })
          : formatPlural(items.length, copy.resultsCount, locale)
        : '';

  return (
    <div className="bundle-picker">
      <label className="form-field__label" htmlFor={`${testIdPrefix}-input`}>
        {label}
      </label>
      <Input
        id={`${testIdPrefix}-input`}
        ref={inputRef}
        data-testid={testIdPrefix}
        type="search"
        role="combobox"
        aria-expanded={active && items.length > 0 && !results.isError}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={stale ? undefined : (nav.activeId ?? undefined)}
        autoComplete="off"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setText(event.target.value);
          setExpanded(null);
          setRejection(null);
          nav.reset();
        }}
      />
      {!active ? <p className="pm-help">{copy.hint}</p> : null}
      <p className="pm-help bundle-picker__status" role="status" aria-live="polite">
        {status}
      </p>
      {rejection !== null ? (
        <p className="bpick__reject form-field__error" role="alert">
          {rejection}
        </p>
      ) : null}
      {results.isError ? (
        <p className="form-field__error" role="alert">
          {copy.failed}
        </p>
      ) : null}
      {settled && items.length === 0 ? (
        <div className="bpick__empty">
          <p className="bpick__empty-t">{interpolate(copy.noResultsTitle, { q: search })}</p>
          <p className="bpick__empty-d">{copy.noResultsBody}</p>
        </div>
      ) : null}
      <ul
        id={listId}
        className="bpick"
        role="listbox"
        aria-label={copy.listLabel}
        aria-busy={results.isFetching || stale}
        hidden={items.length === 0}
        tabIndex={-1}
        style={{ maxHeight: 'min(360px, calc(100dvh - 14rem))', overflowY: 'auto' }}
      >
        {options.map((option) => {
          const { product } = option;
          const isActive = option.id === nav.activeId;
          return (
            <li
              key={product.id}
              id={option.id}
              role="option"
              aria-selected={isActive}
              style={{ scrollMarginBottom: '6rem' }}
              aria-disabled={disabled || option.disabled}
              className={`bpick__row${isActive ? ' is-active' : ''}${option.disabled ? ' is-disabled' : ''}`}
              data-testid={`${testIdPrefix}-result-${product.sku ?? product.id}`}
              onMouseMove={() => {
                if (!isActive) nav.hover(option);
              }}
              onMouseDown={(event) => {
                // Keep the focus in the input so the next key still works.
                event.preventDefault();
              }}
              onClick={() => {
                if (!disabled) void choose(option);
              }}
            >
              <span className="bpick__main">
                <span className="bpick__name">{highlightMatch(product.name, search)}</span>
                {product.sku !== null ? (
                  <span className="bpick__codes mono">
                    <span>{highlightMatch(product.sku, search)}</span>
                  </span>
                ) : null}
                {option.disabled ? <span className="bpick__why">{copy.reasonBundle}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {chooseFailed || (expanded !== null && variants.isError) ? (
        <p className="form-field__error" role="alert" data-testid={`${testIdPrefix}-error`}>
          {formCopy.variantsFailed}
        </p>
      ) : null}
      {expanded !== null && variants.data?.variants ? (
        <div
          className="bundle-picker__variants"
          role="group"
          aria-label={interpolate(formCopy.chooseVariant, { name: expanded.name })}
        >
          <p className="text-muted">{interpolate(formCopy.chooseVariant, { name: expanded.name })}</p>
          {variants.data.variants.map((variant) => {
            const taken = excludeVariantIds.includes(variant.id);
            return (
              <Button
                key={variant.id}
                tone="secondary"
                disabled={taken || disabled}
                title={taken ? copy.reasonTaken : undefined}
                onClick={() => {
                  onPick(toBundleChoice(expanded, variant, variants.data?.variants?.length ?? 2));
                  setText('');
                  setExpanded(null);
                  nav.reset();
                  inputRef.current?.focus();
                }}
              >
                {variantLabel(variant)}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
