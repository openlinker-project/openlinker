/**
 * PromotionProductPicker (#3935)
 *
 * The product choice of a promotion as a card: a dashed "nothing chosen" card
 * with a button, then the search, then the chosen product with its picture, SKU
 * and stock and a Change button. Used for the gift and for the product a
 * condition looks for, so both read the same.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useState, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { BundleProductPicker, type BundleProductChoice } from '../../bundles';
import { useVariantSummaries } from '../../gifts';
import { useInventoryAvailabilityBatchQuery } from '../../inventory';
import type { PickedProduct } from '../lib/promotion-form';
import { GiftGlyph, PromotionThumb } from './promotion-thumb';

export function toPicked(choice: BundleProductChoice): PickedProduct {
  return { productId: choice.productId, variantId: choice.variantId, name: choice.name };
}

export interface PromotionProductPickerProps {
  value: PickedProduct | null;
  onChange: (next: PickedProduct | null) => void;
  emptyTitle: string;
  emptyHelp: string;
  searchLabel: string;
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
  errorText?: string;
  testIdPrefix: string;
}

export function PromotionProductPicker({
  value,
  onChange,
  emptyTitle,
  emptyHelp,
  searchLabel,
  placeholder,
  disabled = false,
  invalid = false,
  errorText,
  testIdPrefix,
}: PromotionProductPickerProps): ReactElement {
  const copy = useMessages('promotions').s.gift;
  const [searching, setSearching] = useState(false);
  const summaries = useVariantSummaries([value?.variantId ?? '']);
  const summary = value === null ? undefined : summaries.get(value.variantId);
  const stock = useInventoryAvailabilityBatchQuery([value?.variantId ?? ''], { enabled: value !== null });
  const available = stock.data?.items.find((item) => item.productVariantId === value?.variantId);
  const units = available?.availableToPromise ?? available?.totalAvailable ?? null;

  const facts = [
    summary?.sku ? interpolate(copy.sku, { sku: summary.sku }) : null,
    stock.isPending ? null : units === null ? copy.stockUnknown : interpolate(copy.inStock, { n: String(units) }),
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className={['form-field', invalid ? 'is-invalid' : ''].filter(Boolean).join(' ')} data-testid={testIdPrefix}>
      {value !== null ? (
        <div className="pm-picker">
          <PromotionThumb seed={value.productId} name={value.name} imageSrc={summary?.imageSrc} size="lg" />
          <span>
            <span className="pm-picker__n">{value.name}</span>
            <br />
            <span className="pm-picker__s">{facts.join(' · ')}</span>
          </span>
          <Button
            tone="secondary"
            className="button--sm"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setSearching(true);
            }}
            data-testid={`${testIdPrefix}-change`}
          >
            {copy.change}
          </Button>
        </div>
      ) : searching ? (
        <BundleProductPicker
          label={searchLabel}
          placeholder={placeholder}
          disabled={disabled}
          onPick={(choice) => {
            onChange(toPicked(choice));
            setSearching(false);
          }}
          testIdPrefix={`${testIdPrefix}-search`}
        />
      ) : (
        <div className="pm-picker is-empty">
          <span className="pm-picker__e">
            <span className="pm-thumb pm-thumb--lg">
              <GiftGlyph />
            </span>
            <span>
              <span className="pm-picker__n">{emptyTitle}</span>
              <br />
              <span className="pm-picker__s">{emptyHelp}</span>
            </span>
            <Button
              tone="secondary"
              className="button--sm"
              disabled={disabled}
              onClick={() => {
                setSearching(true);
              }}
              data-testid={`${testIdPrefix}-choose`}
            >
              {copy.choose}
            </Button>
          </span>
        </div>
      )}
      {invalid && errorText ? <p className="pm-err">{errorText}</p> : null}
    </div>
  );
}
