/**
 * AllegroSetupSummary
 *
 * Live-bound read-only summary panel for the Allegro OAuth connection
 * wizard. Surfaces identity + environment + linked-catalog fields. The
 * client secret is intentionally omitted — it's already masked in the
 * inline review DL, and persisting a masked secret into a persistent
 * side panel would add noise without operational value.
 *
 * The `selectedCatalogName` is passed in as a derived prop (resolved by
 * the form's existing `useProductMasterConnections` subscription) so
 * the summary stays a pure component.
 *
 * @see {@link AllegroSetupForm} for the form this summary is paired with.
 */
import type { ReactElement } from 'react';
import { WizardSummaryRow } from '../../../shared/ui/wizard-summary-row';
import type { AllegroSetupFormValues } from './allegro-setup.schema';

interface AllegroSetupSummaryProps {
  values: AllegroSetupFormValues;
  stepIndex: number;
  selectedCatalogName: string | null;
}

export function AllegroSetupSummary({
  selectedCatalogName,
  stepIndex,
  values,
}: AllegroSetupSummaryProps): ReactElement {
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
          <WizardSummaryRow
            label="Client ID"
            value={values.clientId?.trim() ? values.clientId : null}
            mono
          />
        </dl>
      </section>

      {stepIndex >= 1 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">Environment</h3>
          <dl className="wizard-summary__rows">
            <WizardSummaryRow label="Target" value={environmentLabel} />
          </dl>
        </section>
      ) : null}

      {stepIndex >= 2 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">Product catalog</h3>
          <dl className="wizard-summary__rows">
            <WizardSummaryRow label="Linked to" value={selectedCatalogName ?? '— not linked —'} />
          </dl>
        </section>
      ) : null}
    </>
  );
}
