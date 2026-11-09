/**
 * GiftRuleGiftSection (#3935, mockup `gifts-rule-detail` "Gratis")
 *
 * The gift as a product card (picture, name, SKU, stock), how many, and one line
 * that says who pays: the customer pays 0.00 and the gift costs the seller its
 * purchase price, so a gift is never mistaken for free. The cost read has four
 * states and the sentence never collapses them (see `gift-cost.ts`).
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { formatAmount } from '../../../shared/format/format-amount';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { DetailSection } from '../../../shared/ui/detail-section';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { BundleProductPicker } from '../../bundles';
import { useInventoryAvailabilityBatchQuery } from '../../inventory';
import { VariantThumbnail } from '../../products';
import { useVariantSummaries } from '../hooks/use-variant-summaries';
import { giftCostText, readGiftCost } from '../lib/gift-cost';
import { toPicked } from './gift-rule-picked';
import type { GiftRuleSectionProps } from './gift-rule-section.types';

export function GiftRuleGiftSection({ form, values, readOnly }: GiftRuleSectionProps): ReactElement {
  const copy = useMessages('gifts');
  const apiClient = useApiClient();
  const gift = values.gift;
  const summaries = useVariantSummaries([gift?.variantId ?? '']);
  const summary = gift === null ? undefined : summaries.get(gift.variantId);
  const stock = useInventoryAvailabilityBatchQuery([gift?.variantId ?? ''], { enabled: gift !== null });
  const available = stock.data?.items.find((item) => item.productVariantId === gift?.variantId);
  const units = available?.availableToPromise ?? available?.totalAvailable ?? null;

  const costQuery = useQuery({
    queryKey: ['gifts', 'variant-cost', gift?.productId ?? ''],
    queryFn: () => apiClient.products.getVariantCosts(gift?.productId ?? ''),
    enabled: gift !== null,
  });
  const cost = readGiftCost({
    status: costQuery.status,
    costs: costQuery.data,
    variantId: gift?.variantId,
    currency: values.currency,
  });

  const facts = [
    summary?.sku ? interpolate(copy.detail.sku, { sku: summary.sku }) : null,
    stock.isError || units === null
      ? stock.isPending
        ? null
        : copy.detail.stockUnknown
      : interpolate(copy.detail.inStock, { n: String(units) }),
  ].filter((fact): fact is string => fact !== null);

  return (
    <DetailSection title={copy.composer.gift}>
      <fieldset className="gift-section" disabled={readOnly}>
        <div data-testid="gift-composer-gift-product">
          {gift !== null ? (
            <div className="gift-product-card">
              <VariantThumbnail src={summary?.imageSrc} name={gift.name} size="md" />
              <div className="gift-product-card__text">
                <strong>{gift.name}</strong>
                {facts.length > 0 ? <span className="text-muted">{facts.join(' · ')}</span> : null}
              </div>
              <Button tone="secondary" onClick={() => form.setValue('gift', null)}>
                {copy.composer.change}
              </Button>
            </div>
          ) : (
            <BundleProductPicker
              label={copy.composer.giftLabel}
              placeholder={copy.composer.productPlaceholder}
              disabled={readOnly}
              onPick={(choice) => form.setValue('gift', toPicked(choice))}
              testIdPrefix="gift-composer-gift-search"
            />
          )}
        </div>
        <FormField label={copy.composer.quantity} name="gift-quantity">
          <Input
            type="number"
            min={1}
            value={values.giftQuantity}
            onChange={(event) => form.setValue('giftQuantity', event.target.value)}
            data-testid="gift-composer-gift-qty"
          />
        </FormField>
        {gift !== null ? (
          <p data-testid="gift-composer-who-pays">
            {interpolate(copy.order.customerPays, { price: formatAmount(0, values.currency) })}
            {' · '}
            {giftCostText(
              cost,
              copy.cost,
              {
                known: (unitCost) =>
                  interpolate(copy.composer.costPerUnit, {
                    cost: formatAmount(unitCost, values.currency),
                  }),
                none: copy.composer.costUnknown,
              },
              (template, currency) => interpolate(template, { currency }),
            )}
          </p>
        ) : null}
      </fieldset>
    </DetailSection>
  );
}
