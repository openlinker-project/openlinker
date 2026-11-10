/**
 * PromotionGiftSection (#3935, mockups "Korzyść: gratis")
 *
 * The gift as a product card (picture, name, SKU, stock), how many, and one line
 * that says who pays: the customer pays 0.00 and the gift costs the seller its
 * purchase price, so a gift is never mistaken for free. The cost read has four
 * states and the sentence never collapses them (see `gift-cost.ts`).
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { formatAmount } from '../../../shared/format/format-amount';
import { interpolate, useMessages } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { Input } from '../../../shared/ui/input';
import { readGiftCost } from '../../gifts';
import { PromotionField } from './promotion-field';
import { PromotionProductPicker } from './promotion-product-picker';
import type { PromotionSectionProps } from './promotion-section.types';

export function PromotionGiftSection({
  form,
  values,
  readOnly,
  invalid,
  riseIndex,
  step,
}: PromotionSectionProps): ReactElement {
  const messages = useMessages('promotions');
  const copy = messages.s.gift;
  const giftsCost = useMessages('gifts').cost;
  const apiClient = useApiClient();
  const gift = values.gift;

  const costQuery = useQuery({
    queryKey: ['promotions', 'variant-cost', gift?.productId ?? ''],
    queryFn: () => apiClient.products.getVariantCosts(gift?.productId ?? ''),
    enabled: gift !== null,
  });
  const cost = readGiftCost({
    status: costQuery.status,
    costs: costQuery.data,
    variantId: gift?.variantId,
    currency: values.currency,
  });

  return (
    <ComposerSection
      step={step}
      title={copy.title}
      aside={copy.aside}
      riseIndex={riseIndex}
      data-testid="promotion-gift-section"
    >
      <fieldset className="pm-fieldset" disabled={readOnly}>
        <PromotionProductPicker
          value={gift}
          onChange={(next) => {
            form.setValue('gift', next, { shouldDirty: true });
          }}
          emptyTitle={copy.empty}
          emptyHelp={copy.emptyHelp}
          searchLabel={copy.searchLabel}
          placeholder={copy.searchPlaceholder}
          disabled={readOnly}
          invalid={invalid?.has('gift') === true}
          errorText={copy.error}
          testIdPrefix="promotion-gift"
        />
        <div className="pm-qty">
          <PromotionField
            label={copy.quantity}
            htmlFor="promotion-quantity"
            invalid={invalid?.has('quantity') === true}
          >
            <Input
              id="promotion-quantity"
              className="mono tabular"
              inputMode="numeric"
              value={values.giftQuantity}
              onChange={(event) => {
                form.setValue('giftQuantity', event.target.value, { shouldDirty: true });
              }}
              data-testid="promotion-gift-qty"
            />
          </PromotionField>
        </div>
        <div className="pm-cost" data-testid="promotion-who-pays">
          <span>
            {copy.customerPays} <b className="mono tabular">{formatAmount(0, values.currency)}</b>
          </span>
          {gift !== null ? (
            <>
              <span className="pm-cost__dot" aria-hidden="true">
                ·
              </span>
              <span>
                {cost.kind === 'known' ? (
                  <>
                    {copy.costsYouBefore}
                    <b className="mono tabular">{formatAmount(cost.unitCost, values.currency)}</b>
                    {copy.costsYouAfter}
                  </>
                ) : cost.kind === 'loading' ? (
                  giftsCost.loading
                ) : cost.kind === 'failed' ? (
                  giftsCost.failed
                ) : cost.kind === 'other-currency' ? (
                  interpolate(giftsCost.otherCurrency, { currency: cost.currency })
                ) : (
                  copy.costUnknown
                )}
              </span>
            </>
          ) : null}
        </div>
      </fieldset>
    </ComposerSection>
  );
}
