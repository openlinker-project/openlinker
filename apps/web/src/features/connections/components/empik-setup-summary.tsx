/**
 * EmpikSetupSummary
 *
 * Read-only summary beside the Empik connection wizard: name, environment and
 * shop id entered so far. The API key is left out on purpose; it is masked in
 * the review step and does not belong in a persistent panel.
 *
 * @see {@link EmpikSetupForm}
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { WizardSummaryRow } from '../../../shared/ui/wizard-summary-row';
import type { EmpikSetupFormValues } from './empik-setup.schema';

export function EmpikSetupSummary({ values }: { values: EmpikSetupFormValues }): ReactElement {
  const copy = useMessages('connections').empikSetupSummary;
  return (
    <section className="wizard-summary__section">
      <h3 className="wizard-summary__section-title">{copy.connection}</h3>
      <dl className="wizard-summary__rows">
        <WizardSummaryRow label={copy.name} value={values.name?.trim() ? values.name : null} />
        <WizardSummaryRow label={copy.environment} value={copy.environments[values.environment]} />
        <WizardSummaryRow label={copy.shopId} value={values.shopId?.trim() ? values.shopId : null} />
      </dl>
    </section>
  );
}
