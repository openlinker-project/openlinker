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
  const environmentLabel =
    values.environment === 'production'
      ? 'Production'
      : values.environment === 'sandbox'
        ? 'Sandbox'
        : null;

  return (
    <>
      <section className="wizard-summary__section">
        <h3 className="wizard-summary__section-title">Connection</h3>
        <dl className="wizard-summary__rows">
          <WizardSummaryRow label="Name" value={values.name?.trim() ? values.name : null} />
          <WizardSummaryRow label="Environment" value={environmentLabel} />
        </dl>
      </section>

      {stepIndex >= 1 ? (
        <DeliveryWizardSummary
          value={values.deliveryOnDocuments ?? DEFAULT_DELIVERY_WIZARD_VALUE}
          suggestions={suggestions}
        />
      ) : null}
    </>
  );
}
