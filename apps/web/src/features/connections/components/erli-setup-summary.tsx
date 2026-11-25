/**
 * ErliSetupSummary
 *
 * Live-bound read-only summary panel for the Erli connection wizard. Shows the
 * identity fields entered so far and, from the sales documents step on, what
 * delivery on documents will be saved. The API key is intentionally omitted -
 * it is masked in the review list and does not belong in a persistent panel.
 *
 * @see {@link ErliSetupForm} for the form this summary is paired with.
 */
import { useFormat, useMessages } from '../../../shared/i18n';
import { describeOrderSyncStart } from '../lib/order-sync-start';
import type { ReactElement } from 'react';
import { WizardSummaryRow } from '../../../shared/ui/wizard-summary-row';
import {
  DEFAULT_DELIVERY_WIZARD_VALUE,
  DeliveryWizardSummary,
  type DeliveryLineSuggestion,
} from '../../delivery-on-documents';
import type { ErliSetupFormValues } from './erli-setup.schema';

interface ErliSetupSummaryProps {
  values: ErliSetupFormValues;
  stepIndex: number;
  suggestions?: readonly DeliveryLineSuggestion[];
}

export function ErliSetupSummary({
  stepIndex,
  suggestions = [],
  values,
}: ErliSetupSummaryProps): ReactElement {
  const copy = useMessages('connections').erliSetupSummary;
  const orderCopy = useMessages('connections').orderSyncStart;
  const format = useFormat();
  const environmentLabel =
    values.environment === 'production'
      ? copy.environments.production
      : values.environment === 'sandbox'
        ? copy.environments.sandbox
        : null;

  return (
    <>
      <section className="wizard-summary__section">
        <h3 className="wizard-summary__section-title">{copy.connection}</h3>
        <dl className="wizard-summary__rows">
          <WizardSummaryRow label={copy.name} value={values.name?.trim() ? values.name : null} />
          <WizardSummaryRow label={copy.environment} value={environmentLabel} />
          {stepIndex >= 1 ? (
            <WizardSummaryRow
              label={copy.productCatalogue}
              value={values.catalogueMode === 'none' ? copy.noCatalogue : copy.linkedLater}
            />
          ) : null}
          <WizardSummaryRow
            label={orderCopy.review.label}
            value={describeOrderSyncStart(values.orderSyncStart, orderCopy.review, format.date)}
          />
        </dl>
      </section>

      {stepIndex >= 2 ? (
        <DeliveryWizardSummary
          value={values.deliveryOnDocuments ?? DEFAULT_DELIVERY_WIZARD_VALUE}
          suggestions={suggestions}
        />
      ) : null}
    </>
  );
}
