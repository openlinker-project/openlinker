/**
 * Delivery on documents - wizard summary section (#3911)
 *
 * The "Delivery on documents" block of the setup wizards' side panel: one row
 * per country plus "All other countries", i.e. exactly what will be saved.
 *
 * @module apps/web/src/features/delivery-on-documents/components
 */
import type { ReactElement } from 'react';
import { WizardSummaryRow } from '../../../shared/ui/wizard-summary-row';
import type { DeliveryLineSuggestion } from '../api/delivery-on-documents.types';
import {
  wizardRules,
  wizardSummaryRows,
  type DeliveryWizardValue,
} from '../lib/delivery-wizard';

interface DeliveryWizardSummaryProps {
  value: DeliveryWizardValue;
  suggestions: readonly DeliveryLineSuggestion[];
}

export function DeliveryWizardSummary({
  value,
  suggestions,
}: DeliveryWizardSummaryProps): ReactElement {
  return (
    <section className="wizard-summary__section">
      <h3 className="wizard-summary__section-title">Delivery on documents</h3>
      <dl className="wizard-summary__rows">
        {wizardSummaryRows(wizardRules(value, suggestions)).map((row) => (
          <WizardSummaryRow key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
    </section>
  );
}
