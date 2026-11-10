/**
 * Bundle product picker (#3624)
 *
 * One search box that finds a product by name or SKU and hands back the
 * variant the operator means. A product with a single variant is picked in one
 * click; one with several asks which variant, because a bundle and its
 * components are variants and guessing one would put the wrong stock in a set.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { useMessages } from '../../../shared/i18n';
import { interpolate } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { toBundleChoice, variantLabel, type BundleProductChoice } from '../lib/bundle-choice';
import type { Product } from '../../products';

export interface BundleProductPickerProps {
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** Variants that are already chosen; they are listed but cannot be picked again. */
  excludeVariantIds?: readonly string[];
  onPick: (choice: BundleProductChoice) => void;
  testIdPrefix: string;
}

export function BundleProductPicker({
  label,
  placeholder,
  disabled = false,
  excludeVariantIds = [],
  onPick,
  testIdPrefix,
}: BundleProductPickerProps): ReactElement {
  const copy = useMessages('bundles');
  const apiClient = useApiClient();
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState<Product | null>(null);
  const search = useDebouncedValue(text.trim(), 250);

  const results = useQuery({
    queryKey: ['bundles', 'product-search', search],
    queryFn: () => apiClient.products.listRows({ search }, { limit: 8, offset: 0 }),
    enabled: search.length >= 2,
  });

  const variants = useQuery({
    queryKey: ['bundles', 'product-variants', expanded?.id ?? ''],
    queryFn: () => apiClient.products.getById(expanded?.id ?? ''),
    enabled: expanded !== null,
  });

  const [chooseFailed, setChooseFailed] = useState(false);
  const choose = async (product: Product): Promise<void> => {
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
      return;
    }
    setExpanded(product);
  };

  return (
    <div className="bundle-picker">
      <label className="form-field__label" htmlFor={`${testIdPrefix}-input`}>
        {label}
      </label>
      <Input
        id={`${testIdPrefix}-input`}
        data-testid={testIdPrefix}
        type="search"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
          setExpanded(null);
        }}
      />
      {search.length >= 2 && results.data !== undefined && results.data.items.length === 0 ? (
        <p className="text-muted">{copy.form.noResults}</p>
      ) : null}
      {search.length >= 2 && results.data !== undefined && results.data.items.length > 0 ? (
        <ul className="bundle-picker__results" role="list">
          {results.data.items.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                className="bundle-picker__result"
                disabled={disabled}
                data-testid={`${testIdPrefix}-result-${product.sku ?? product.id}`}
                onClick={() => {
                  void choose(product);
                }}
              >
                <span>{product.name}</span>
                <span className="mono-text text-muted">{product.sku ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {chooseFailed || (expanded !== null && variants.isError) ? (
        <p className="form-field__error" role="alert" data-testid={`${testIdPrefix}-error`}>
          {copy.form.variantsFailed}
        </p>
      ) : null}
      {expanded !== null && variants.data?.variants ? (
        <div className="bundle-picker__variants" role="group" aria-label={interpolate(copy.form.chooseVariant, { name: expanded.name })}>
          <p className="text-muted">{interpolate(copy.form.chooseVariant, { name: expanded.name })}</p>
          {variants.data.variants.map((variant) => {
            const taken = excludeVariantIds.includes(variant.id);
            return (
              <Button
                key={variant.id}
                tone="secondary"
                disabled={taken || disabled}
                title={taken ? copy.form.alreadyAComponent : undefined}
                onClick={() => {
                  onPick(toBundleChoice(expanded, variant, variants.data?.variants?.length ?? 2));
                  setText('');
                  setExpanded(null);
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
