/**
 * PromotionWhenSection (#3935, mockups "Kiedy")
 *
 * When does the customer get the gift: from an order amount, when the order
 * contains a product, or for every unit of a product. The third choice sits on
 * the new-promotion page; on a saved promotion it appears only when the
 * promotion already is one, because its options (1 gift per N, a ceiling per
 * order) belong to it alone.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl, type SegmentedControlOption } from '../../../shared/ui/segmented-control';
import { Select } from '../../../shared/ui/select';
import type { PromotionKind } from '../lib/promotion-form';
import { PromotionField } from './promotion-field';
import { PromotionProductPicker } from './promotion-product-picker';
import type { PromotionSectionProps } from './promotion-section.types';

const CURRENCIES = ['PLN', 'EUR', 'CZK', 'HUF', 'USD', 'GBP'];

export interface PromotionWhenSectionProps extends PromotionSectionProps {
  /** Offer "For every unit" as a choice (the new page), not only when already chosen. */
  offerUnit?: boolean;
}

export function PromotionWhenSection({
  form,
  values,
  readOnly,
  invalid,
  riseIndex,
  step,
  offerUnit = false,
}: PromotionWhenSectionProps): ReactElement {
  const messages = useMessages('promotions');
  const copy = messages.s.when;
  const options: SegmentedControlOption<PromotionKind>[] = [
    { value: 'basket', label: copy.basket, 'data-testid': 'promotion-kind-basket' },
    { value: 'product', label: copy.product, 'data-testid': 'promotion-kind-product' },
  ];
  if (offerUnit || values.kind === 'unit') {
    options.push({ value: 'unit', label: copy.unit, 'data-testid': 'promotion-kind-unit' });
  }

  return (
    <ComposerSection
      step={step}
      title={copy.title}
      aside={copy.aside[values.kind]}
      riseIndex={riseIndex}
      data-testid="promotion-when-section"
    >
      <fieldset className="pm-fieldset" disabled={readOnly}>
        <SegmentedControl
          aria-label={copy.group}
          options={options}
          value={values.kind}
          onChange={(kind) => {
            form.setValue('kind', kind, { shouldDirty: true });
          }}
        />
        {values.kind === 'basket' ? (
          <div data-testid="promotion-when-basket">
            <div className="pm-row2">
              <PromotionField
                label={copy.amount}
                htmlFor="promotion-amount"
                required={step !== undefined}
                invalid={invalid?.has('basket') === true}
                error={copy.amountError}
              >
                <Input
                  id="promotion-amount"
                  className="mono tabular"
                  inputMode="decimal"
                  placeholder={copy.amountPlaceholder}
                  value={values.basketMin}
                  onChange={(event) => {
                    form.setValue('basketMin', event.target.value, { shouldDirty: true });
                  }}
                  data-testid="promotion-basket-min"
                />
              </PromotionField>
              <PromotionField label={copy.currency} htmlFor="promotion-currency">
                <Select
                  id="promotion-currency"
                  value={values.currency}
                  onChange={(event) => {
                    form.setValue('currency', event.target.value, { shouldDirty: true });
                  }}
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </Select>
              </PromotionField>
            </div>
            <p className="form-field__description pm-after-row">{copy.amountHelp}</p>
          </div>
        ) : (
          <div data-testid="promotion-when-product">
            <PromotionField
              label={copy.product_label}
              required={step !== undefined}
              className="pm-when-pick"
            >
              <PromotionProductPicker
                value={values.when}
                onChange={(next) => {
                  form.setValue('when', next, { shouldDirty: true });
                }}
                emptyTitle={copy.productEmpty}
                emptyHelp={copy.productEmptyHelp}
                searchLabel={copy.product_label}
                placeholder={messages.s.gift.searchPlaceholder}
                disabled={readOnly}
                invalid={invalid?.has('when') === true}
                errorText={copy.productError}
                testIdPrefix="promotion-when"
              />
            </PromotionField>
            {values.kind === 'unit' ? (
              <div className="pm-row2 pm-after-row">
                <PromotionField
                  label={copy.perN}
                  htmlFor="promotion-per-n"
                  invalid={invalid?.has('per-n') === true}
                >
                  <Input
                    id="promotion-per-n"
                    className="mono tabular"
                    inputMode="numeric"
                    value={values.perN}
                    onChange={(event) => {
                      form.setValue('perN', event.target.value, { shouldDirty: true });
                    }}
                    data-testid="promotion-per-n"
                  />
                </PromotionField>
                <PromotionField label={copy.maxPerOrder} htmlFor="promotion-max-per-order">
                  <Input
                    id="promotion-max-per-order"
                    className="mono tabular"
                    inputMode="numeric"
                    placeholder={copy.maxPerOrderPlaceholder}
                    value={values.maxPerOrder}
                    onChange={(event) => {
                      form.setValue('maxPerOrder', event.target.value, { shouldDirty: true });
                    }}
                    data-testid="promotion-max-per-order"
                  />
                </PromotionField>
              </div>
            ) : null}
          </div>
        )}
      </fieldset>
    </ComposerSection>
  );
}
