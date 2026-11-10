/**
 * GiftRuleLimitsSection (#3935, mockup `gifts-rule-detail` "Limity i dokumenty")
 *
 * The limits and the document line an operator reaches for, with the options
 * most promotions never touch folded under "More options" and a one-line summary
 * of how they stand.
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { DetailSection } from '../../../shared/ui/detail-section';
import { FormField } from '../../../shared/ui/form-field';
import { InlineDisclosure } from '../../../shared/ui/inline-disclosure';
import { Input } from '../../../shared/ui/input';
import { GiftDocumentFormField } from '../../gift-documents';
import type { GiftRuleSectionProps } from './gift-rule-section.types';

export function GiftRuleLimitsSection({ form, values, readOnly }: GiftRuleSectionProps): ReactElement {
  const copy = useMessages('gifts');

  const moreSummary = [
    values.doNotCombine ? copy.composer.summary.noStack : copy.composer.summary.combines,
    values.skipIfPresent ? copy.detail.skipsPresent : copy.detail.givesAgain,
    values.customerLimit.trim() === ''
      ? copy.detail.noCustomerLimit
      : interpolate(copy.detail.customerLimitN, { n: values.customerLimit.trim() }),
  ].join(' · ');

  return (
    <DetailSection title={copy.detail.limits}>
      <fieldset className="gift-section" disabled={readOnly}>
        <FormField label={copy.composer.unitCap} name="gift-unit-cap">
          <Input
            type="number"
            min={1}
            value={values.unitCap}
            onChange={(event) => form.setValue('unitCap', event.target.value)}
            data-testid="gift-composer-opt-unit-cap"
          />
        </FormField>
        {values.kind === 'unit' ? (
          <div className="gift-section__row">
            <FormField label={copy.composer.perN} name="gift-per-n">
              <Input
                type="number"
                min={1}
                value={values.perN}
                onChange={(event) => form.setValue('perN', event.target.value)}
                data-testid="gift-composer-opt-per-n"
              />
            </FormField>
            <FormField label={copy.composer.maxPerOrder} name="gift-max-per-order">
              <Input
                type="number"
                min={1}
                value={values.maxPerOrder}
                onChange={(event) => form.setValue('maxPerOrder', event.target.value)}
                data-testid="gift-composer-opt-max-order"
              />
            </FormField>
          </div>
        ) : null}
        <FormField label={copy.composer.docForm} name="gift-doc-form">
          <GiftDocumentFormField
            data-testid="gift-composer-opt-doc-form"
            value={values.documentForm}
            onChange={(next) => form.setValue('documentForm', next)}
          />
        </FormField>

        <div data-testid="gift-composer-more">
          <InlineDisclosure label={copy.detail.moreOptions} value={moreSummary}>
            <div className="gift-section">
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={values.doNotCombine}
                  onChange={(event) => form.setValue('doNotCombine', event.target.checked)}
                  data-testid="gift-composer-opt-no-stack"
                />
                <span className="filter-check__label">{copy.composer.noStack}</span>
              </label>
              <p className="text-muted gift-section__hint">{copy.detail.noStackHint}</p>
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={values.skipIfPresent}
                  onChange={(event) => form.setValue('skipIfPresent', event.target.checked)}
                  data-testid="gift-composer-opt-skip-present"
                />
                <span className="filter-check__label">{copy.composer.skipPresent}</span>
              </label>
              <FormField label={copy.composer.perCustomer} name="gift-per-customer">
                <Input
                  type="number"
                  min={1}
                  value={values.customerLimit}
                  onChange={(event) => form.setValue('customerLimit', event.target.value)}
                  data-testid="gift-composer-opt-per-customer"
                />
              </FormField>
            </div>
          </InlineDisclosure>
        </div>
      </fieldset>
    </DetailSection>
  );
}
