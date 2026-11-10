/**
 * GiftRuleWhenSection (#3935, mockup `gifts-rule-detail` "Kiedy")
 *
 * When does the customer get the gift: from an order amount, or when the order
 * contains a product. A rule that gives a gift for every unit keeps that third
 * choice visible but it is not offered on other rules, because the unit options
 * (1 gift per N, maximum per order) belong to it alone.
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { DetailSection } from '../../../shared/ui/detail-section';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { SegmentedControl, type SegmentedControlOption } from '../../../shared/ui/segmented-control';
import { BundleProductPicker } from '../../bundles';
import type { GiftRuleKind } from '../lib/gift-rule-form';
import type { GiftRuleSectionProps } from './gift-rule-section.types';
import { toPicked } from './gift-rule-picked';

const CURRENCIES = ['PLN', 'EUR', 'CZK', 'HUF', 'USD', 'GBP'];

export function GiftRuleWhenSection({ form, values, readOnly }: GiftRuleSectionProps): ReactElement {
  const copy = useMessages('gifts');
  const options: SegmentedControlOption<GiftRuleKind>[] = [
    { value: 'basket', label: copy.detail.kindBasket, 'data-testid': 'gift-composer-kind-basket' },
    { value: 'product', label: copy.detail.kindProduct, 'data-testid': 'gift-composer-kind-product' },
  ];
  if (values.kind === 'unit') {
    options.push({ value: 'unit', label: copy.detail.kindUnit, 'data-testid': 'gift-composer-kind-unit' });
  }

  return (
    <DetailSection title={copy.composer.when}>
      <fieldset className="gift-section" disabled={readOnly}>
        <SegmentedControl
          className="gift-when-toggle"
          aria-label={copy.detail.kindLabel}
          options={options}
          value={values.kind}
          onChange={(kind) => form.setValue('kind', kind)}
        />
        {values.kind === 'basket' ? (
          <div className="gift-section__row" data-testid="gift-composer-when-basket">
            <FormField label={copy.composer.basketFrom} name="gift-basket-min">
              <Input
                inputMode="decimal"
                value={values.basketMin}
                onChange={(event) => form.setValue('basketMin', event.target.value)}
                data-testid="gift-composer-basket-min"
              />
            </FormField>
            <FormField label={copy.composer.currency} name="gift-currency">
              <Select
                value={values.currency}
                onChange={(event) => form.setValue('currency', event.target.value)}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </FormField>
            <p className="text-muted gift-section__hint">{copy.composer.basketHelp}</p>
          </div>
        ) : (
          <div data-testid="gift-composer-when-product">
            <p className="text-muted">
              {values.kind === 'unit' ? copy.composer.unitProductHelp : copy.composer.productHelp}
            </p>
            {values.when !== null ? (
              <p className="gift-section__picked">
                <strong>{values.when.name}</strong>
                <Button tone="secondary" onClick={() => form.setValue('when', null)}>
                  {copy.composer.change}
                </Button>
              </p>
            ) : (
              <BundleProductPicker
                label={copy.composer.productLabel}
                placeholder={copy.composer.productPlaceholder}
                disabled={readOnly}
                onPick={(choice) => form.setValue('when', toPicked(choice))}
                testIdPrefix="gift-composer-when-search"
              />
            )}
          </div>
        )}
      </fieldset>
    </DetailSection>
  );
}
