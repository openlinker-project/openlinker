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
import {
  DEFAULT_DELIVERY_WIZARD_VALUE,
  DeliveryWizardSummary,
  type DeliveryLineSuggestion,
} from '../../delivery-on-documents';
import { WizardSummaryRow } from '../../../shared/ui/wizard-summary-row';
import type { AllegroSetupFormValues } from './allegro-setup.schema';
import { useMessages } from '../../../shared/i18n';

interface AllegroSetupSummaryProps {
  values: AllegroSetupFormValues;
  stepIndex: number;
  selectedCatalogName: string | null;
  suggestions?: readonly DeliveryLineSuggestion[];
  /** False when re-authenticating: that flow never touches delivery settings. */
  showDelivery?: boolean;
}

export function AllegroSetupSummary({
  selectedCatalogName,
  showDelivery = true,
  stepIndex,
  suggestions = [],
  values,
}: AllegroSetupSummaryProps): ReactElement {
  const copy = useMessages('allegro-core').allegroSetupSummary;
  const environmentLabel =
    values.environment === 'production'
      ? copy.production
      : values.environment === 'sandbox'
        ? copy.sandbox
        : null;

  return (
    <>
      <section className="wizard-summary__section">
        <h3 className="wizard-summary__section-title">{copy.connection}</h3>
        <dl className="wizard-summary__rows">
          <WizardSummaryRow label={copy.name} value={values.name?.trim() ? values.name : null} />
          <WizardSummaryRow
            label={copy.clientId}
            value={values.clientId?.trim() ? values.clientId : null}
            mono
          />
        </dl>
      </section>

      {stepIndex >= 1 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">{copy.environment}</h3>
          <dl className="wizard-summary__rows">
            <WizardSummaryRow label={copy.target} value={environmentLabel} />
          </dl>
        </section>
      ) : null}

      {stepIndex >= 2 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">{copy.productCatalogue}</h3>
          <dl className="wizard-summary__rows">
            <WizardSummaryRow label={copy.linkedTo} value={selectedCatalogName ?? copy.notLinked} />
          </dl>
        </section>
      ) : null}

      {showDelivery && stepIndex >= 3 ? (
        <DeliveryWizardSummary
          value={values.deliveryOnDocuments ?? DEFAULT_DELIVERY_WIZARD_VALUE}
          suggestions={suggestions}
        />
      ) : null}
    </>
  );
}
