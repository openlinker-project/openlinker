/**
 * PromotionLimitsSection (#3935, mockups "Limity i dokumenty")
 *
 * The piece limit for the whole promotion, the most one customer can get, and
 * how the gift looks on an invoice or receipt. The last is cards with a mini
 * document each, because "0.01 taken from the most expensive item" means little
 * until you see the total did not move.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { HelpHint } from '../../../shared/ui/help-hint';
import { Input } from '../../../shared/ui/input';
import {
  GiftDocumentFormCards,
  useGiftDocumentSettingsQuery,
  type GiftDocumentCardValue,
} from '../../gift-documents';
import { PromotionField } from './promotion-field';
import type { PromotionSectionProps } from './promotion-section.types';

export interface PromotionLimitsSectionProps extends PromotionSectionProps {
  /** "34 / 100 pcs" on a saved promotion; the new page says "optional". */
  aside?: string;
  /** Use the "once the limit is given out" help without the "resume" sentence. */
  isNew?: boolean;
  /** Where "Change the default" goes. */
  settingsHref?: string;
}

export function PromotionLimitsSection({
  form,
  values,
  readOnly,
  invalid,
  riseIndex,
  step,
  aside,
  isNew = false,
  settingsHref,
}: PromotionLimitsSectionProps): ReactElement {
  const copy = useMessages('promotions').s.limits;
  const settings = useGiftDocumentSettingsQuery();
  const cardValue: GiftDocumentCardValue = values.documentForm === '' ? 'inherit' : values.documentForm;
  return (
    <ComposerSection
      step={step}
      title={copy.title}
      aside={aside ?? copy.aside}
      riseIndex={riseIndex}
      data-testid="promotion-limits-section"
    >
      <fieldset className="pm-fieldset" disabled={readOnly}>
        <PromotionField
          label={copy.unitCap}
          htmlFor="promotion-unit-cap"
          hint={<HelpHint guide="g-limit" label={copy.unitCapLabel} />}
          description={isNew ? copy.unitCapHelpNew : copy.unitCapHelp}
          invalid={invalid?.has('unit-cap') === true}
          error={copy.unitCapError}
        >
          <Input
            id="promotion-unit-cap"
            className="mono tabular pm-narrow"
            inputMode="numeric"
            placeholder={copy.unitCapPlaceholder}
            value={values.unitCap}
            onChange={(event) => {
              form.setValue('unitCap', event.target.value, { shouldDirty: true });
            }}
            data-testid="promotion-unit-cap"
          />
        </PromotionField>
        <PromotionField
          label={copy.perCustomer}
          htmlFor="promotion-customer-limit"
          hint={<HelpHint guide="g-perclient" label={copy.perCustomerLabel} />}
          description={copy.perCustomerHelp}
        >
          <Input
            id="promotion-customer-limit"
            className="mono tabular pm-narrow"
            inputMode="numeric"
            placeholder={copy.perCustomerPlaceholder}
            value={values.customerLimit}
            onChange={(event) => {
              form.setValue('customerLimit', event.target.value, { shouldDirty: true });
            }}
            data-testid="promotion-customer-limit"
          />
        </PromotionField>
        <PromotionField
          label={copy.doc}
          hint={<HelpHint guide="g-doc" label={copy.docLabel} />}
          description={copy.docHelp}
          invalid={invalid?.has('doc-price') === true}
          error={copy.docPriceError}
        >
          <GiftDocumentFormCards
            name="promotion-doc"
            aria-label={copy.doc}
            value={cardValue}
            onChange={(next) => {
              form.setValue('documentForm', next === 'inherit' ? '' : next, { shouldDirty: true });
            }}
            customPrice={values.documentUnitPrice}
            onCustomPriceChange={(next) => {
              form.setValue('documentUnitPrice', next, { shouldDirty: true });
            }}
            withInherit
            inheritedForm={settings.data?.giftDocumentForm ?? null}
            settingsHref={settingsHref}
            currency={values.currency}
            disabled={readOnly}
            invalidPrice={invalid?.has('doc-price') === true}
          />
        </PromotionField>
      </fieldset>
    </ComposerSection>
  );
}

