/**
 * OfferProductPickerRow
 *
 * One product row of `OfferProductPickerModal` (#1819 extraction, unchanged
 * behaviour). Lazily loads its variants when expanded (passing an empty id
 * keeps `useProductQuery` disabled until then). Computes its own tri-state
 * and reports its loaded variants up so the parent can total items across
 * products and render the selection rail even after paging away.
 *
 * @module apps/web/src/features/listings/components
 */
import { useEffect, useMemo, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { CheckboxCell } from '../../../shared/ui/checkbox-cell';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { useProductQuery } from '../../products';
import type { Product, ProductVariant } from '../../products';
import {
  firstImage,
  variantHasBarcode,
  variantLabel,
  variantShortLabel,
} from '../lib/offer-product-picker-selectors';
import { OFFER_PICKER_PRODUCT_CAP, type SelectionEntry } from './offer-product-picker.types';

interface OfferProductPickerRowProps {
  product: Product;
  isExpanded: boolean;
  entry: SelectionEntry | undefined;
  capBlocked: boolean;
  onToggleExpand: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleVariant: (variantId: string, loadedVariantIds: string[]) => void;
  onVariantsLoaded: (variants: ProductVariant[]) => void;
}

export function OfferProductPickerRow({
  product,
  isExpanded,
  entry,
  capBlocked,
  onToggleExpand,
  onSelectAll,
  onClear,
  onToggleVariant,
  onVariantsLoaded,
}: OfferProductPickerRowProps): ReactElement {
  const detailQuery = useProductQuery(isExpanded ? product.id : '');
  const loadedVariants = useMemo(
    () => detailQuery.data?.variants ?? [],
    [detailQuery.data],
  );
  const loadedVariantIds = useMemo(() => loadedVariants.map((v) => v.id), [loadedVariants]);

  // Report loaded variants up for the item-count total + rail review.
  useEffect(() => {
    if (isExpanded && detailQuery.data) {
      onVariantsLoaded(loadedVariants);
    }
  }, [isExpanded, detailQuery.data, loadedVariants, onVariantsLoaded]);

  const selectedVariantIds = entry instanceof Set ? entry : null;
  const allLoadedSelected =
    loadedVariantIds.length > 0 &&
    selectedVariantIds !== null &&
    loadedVariantIds.every((id) => selectedVariantIds.has(id));

  const checkboxState: 'all' | 'some' | 'none' =
    entry === 'ALL' || allLoadedSelected
      ? 'all'
      : selectedVariantIds !== null && selectedVariantIds.size > 0
        ? 'some'
        : 'none';

  const handleToggleProduct = (): void => {
    if (checkboxState === 'all') onClear();
    else onSelectAll();
  };

  const variantCount = product.variantCount;
  const isSimple = typeof variantCount === 'number' && variantCount <= 1;
  const rowClasses = [
    'offer-product-picker__prow',
    isExpanded ? 'offer-product-picker__prow--open' : '',
    isSimple ? 'offer-product-picker__prow--simple' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClasses}>
      <div className="offer-product-picker__prow-main">
        {/* Full 44px hit area for whole-product selection so it matches the
            variant rows' tap target on mobile (a bare checkbox is ~16px). The
            wrapping label toggles the nested checkbox natively. */}
        <label className="offer-product-picker__prow-check">
          <CheckboxCell
            state={checkboxState}
            onToggle={handleToggleProduct}
            disabled={capBlocked}
            ariaLabel={`Select ${product.name}`}
            tooltip={
              capBlocked
                ? `Maximum ${OFFER_PICKER_PRODUCT_CAP} products per batch reached`
                : undefined
            }
          />
        </label>
        <button
          type="button"
          className="offer-product-picker__prow-toggle"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${product.name}`}
        >
          <ProductThumbnail name={product.name} src={firstImage(product.images)} size="md" />
          <span className="offer-product-picker__pname">
            <b>{product.name}</b>
            <small className="mono-text">{product.sku ?? '—'}</small>
          </span>
          {typeof variantCount === 'number' ? (
            <span
              className={`offer-product-picker__vcount${
                isSimple ? ' offer-product-picker__vcount--simple' : ''
              }`}
            >
              {variantCount} {variantCount === 1 ? 'variant' : 'variants'}
            </span>
          ) : null}
          <span className="offer-product-picker__chev" aria-hidden="true">
            ▸
          </span>
        </button>
      </div>

      {isExpanded ? (
        <ul className="offer-product-picker__vrows">
          {detailQuery.isLoading ? (
            <li className="muted-text">Loading variants…</li>
          ) : detailQuery.error ? (
            <li>
              <Alert
                tone="error"
                title="Unable to load variants"
                action={
                  <Button
                    tone="secondary"
                    type="button"
                    onClick={() => void detailQuery.refetch()}
                  >
                    Retry
                  </Button>
                }
              >
                {detailQuery.error.message}
              </Alert>
            </li>
          ) : loadedVariants.length === 0 ? (
            <li className="muted-text">No variants on this product.</li>
          ) : (
            loadedVariants.map((variant) => {
              const picked = entry === 'ALL' || (selectedVariantIds?.has(variant.id) ?? false);
              const hasBarcode = variantHasBarcode(variant);
              return (
                <li key={variant.id}>
                  <label
                    className={`offer-product-picker__vrow${picked ? ' offer-product-picker__vrow--picked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={capBlocked}
                      onChange={() => onToggleVariant(variant.id, loadedVariantIds)}
                    />
                    <ProductThumbnail
                      name={variantShortLabel(variant)}
                      src={null}
                      size="sm"
                    />
                    <span className="offer-product-picker__vname">
                      <b>{variantLabel(detailQuery.data ?? product, variant)}</b>
                      <small className={`mono-text${hasBarcode ? '' : ' offer-product-picker__vname-bad'}`}>
                        SKU {variant.sku ?? '—'} · {hasBarcode ? `EAN ${variant.ean ?? variant.gtin ?? '—'}` : 'no EAN'}
                      </small>
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </li>
  );
}
