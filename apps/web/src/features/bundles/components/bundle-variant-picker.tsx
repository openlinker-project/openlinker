/**
 * Bundle variant picker (#3935)
 *
 * Finds what goes into a bundle the way people look for it: a search box whose
 * results are pictures first. Every result is one VARIANT (a product with three
 * pack sizes is three rows under its name), with its attributes ("250 g,
 * ziarnista"), SKU, EAN, the stock OpenLinker would promise and the price, so
 * nobody has to open a second page to be sure it is the right one. A product's
 * variants and their stock are read only for the few results on screen.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useId, useMemo, useState, type ReactElement } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Input } from '../../../shared/ui/input';
import { VariantThumbnail, type Product, type ProductVariant } from '../../products';
import { toBundleChoice, type BundleProductChoice } from '../lib/bundle-choice';

export interface BundleVariantPickerProps {
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** Variants already chosen: listed, marked, not pickable again. */
  excludeVariantIds?: readonly string[];
  onPick: (choice: BundleProductChoice) => void;
  testIdPrefix: string;
}

function attributeText(variant: ProductVariant): string {
  return variant.attributes ? Object.values(variant.attributes).join(', ') : '';
}

export function BundleVariantPicker({
  label,
  placeholder,
  disabled = false,
  excludeVariantIds = [],
  onPick,
  testIdPrefix,
}: BundleVariantPickerProps): ReactElement {
  const copy = useMessages('bundles').picker;
  const apiClient = useApiClient();
  const format = useFormat();
  const inputId = useId();
  const [text, setText] = useState('');
  const search = useDebouncedValue(text.trim(), 250);

  const results = useQuery({
    queryKey: ['bundles', 'product-search', search],
    queryFn: () => apiClient.products.listRows({ search }, { limit: 6, offset: 0 }),
    enabled: search.length >= 2,
  });
  const products = useMemo<Product[]>(() => results.data?.items ?? [], [results.data]);

  const details = useQueries({
    queries: products.map((product) => ({
      queryKey: ['bundles', 'product-detail', product.id],
      queryFn: () => apiClient.products.getById(product.id),
      staleTime: 30_000,
    })),
  });
  const variantIds = details.flatMap((d) => (d.data?.variants ?? []).map((v) => v.id));
  const stock = useQuery({
    queryKey: ['bundles', 'variant-stock', [...variantIds].sort().join(',')],
    queryFn: () => apiClient.inventory.availability(variantIds),
    enabled: variantIds.length > 0,
    staleTime: 30_000,
  });
  const stockByVariant = new Map(
    (stock.data?.items ?? []).map((item) => [item.productVariantId, item.availableToPromise ?? null])
  );

  const searching = search.length >= 2 && (results.isFetching || details.some((d) => d.isLoading));

  return (
    <div className="bundle-picker">
      <label className="form-field__label" htmlFor={inputId}>
        {label}
      </label>
      <Input
        id={inputId}
        data-testid={testIdPrefix}
        type="search"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {search.length < 2 ? <p className="pm-help">{copy.hint}</p> : null}
      {search.length >= 2 && !searching && results.data !== undefined && products.length === 0 ? (
        <p className="text-muted">{copy.noResults}</p>
      ) : null}
      {results.isError ? (
        <p className="form-field__error" role="alert">
          {copy.failed}
        </p>
      ) : null}
      <ul className="bpick" role="list" aria-busy={searching}>
        {products.map((product, index) => {
          const detail = details[index]?.data;
          const variants = detail?.variants ?? [];
          if (variants.length === 0) {
            return (
              <li key={product.id} className="bpick__group bpick__group--loading">
                <span className="bpick__skeleton" />
                <span>{product.name}</span>
              </li>
            );
          }
          return (
            <li key={product.id} className="bpick__group">
              {variants.length > 1 ? (
                <p className="bpick__product">{product.name}</p>
              ) : null}
              <ul role="list">
                {variants.map((variant) => {
                  const taken = excludeVariantIds.includes(variant.id);
                  const atp = stockByVariant.get(variant.id);
                  const price = variant.price ?? product.price;
                  const attrs = attributeText(variant);
                  const sku = variant.sku ?? product.sku;
                  const title =
                    variants.length > 1 && attrs !== '' ? attrs : product.name;
                  return (
                    <li key={variant.id}>
                      <button
                        type="button"
                        className="bpick__row"
                        disabled={disabled || taken}
                        data-testid={`${testIdPrefix}-result-${sku ?? variant.id}`}
                        onClick={() => {
                          onPick(toBundleChoice(product, variant, variants.length, atp));
                          setText('');
                        }}
                      >
                        <VariantThumbnail
                          src={variant.imageUrls?.[0]}
                          name={product.name}
                          size="md"
                        />
                        <span className="bpick__main">
                          <span className="bpick__name">{title}</span>
                          {variants.length > 1 && attrs === '' ? (
                            <span className="bpick__attrs">{product.name}</span>
                          ) : null}
                          <span className="bpick__codes mono">
                            {sku !== null ? <span>{sku}</span> : null}
                            {variant.ean !== null ? (
                              <span>{interpolate(copy.ean, { ean: variant.ean })}</span>
                            ) : null}
                          </span>
                        </span>
                        <span className="bpick__side">
                          <span className="bpick__stock">
                            {atp === undefined || atp === null
                              ? copy.stockUnknown
                              : interpolate(copy.stock, { n: atp })}
                          </span>
                          {price !== null ? (
                            <span className="bpick__price mono tabular">
                              {format.money(price, product.currency ?? undefined)}
                            </span>
                          ) : null}
                          {taken ? <span className="bpick__taken">{copy.taken}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
