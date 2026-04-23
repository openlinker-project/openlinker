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
import { EmptyValue } from '../../../shared/ui/empty-value';
import type { AllegroSetupFormValues } from './allegro-setup.schema';

interface AllegroSetupSummaryProps {
  values: AllegroSetupFormValues;
  stepIndex: number;
  selectedCatalogName: string | null;
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}): ReactElement {
  return (
    <div className="wizard-summary__row">
      <span className="wizard-summary__label">{label}</span>
      {value ? (
        <span
          className={['wizard-summary__value', mono ? 'mono-text' : ''].filter(Boolean).join(' ')}
        >
          {value}
        </span>
      ) : (
        <EmptyValue />
      )}
    </div>
  );
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
        <SummaryRow label="Name" value={values.name?.trim() ? values.name : null} />
        <SummaryRow
          label="Client ID"
          value={values.clientId?.trim() ? values.clientId : null}
          mono
        />
      </section>

      {stepIndex >= 1 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">Environment</h3>
          <SummaryRow label="Target" value={environmentLabel} />
        </section>
      ) : null}

      {stepIndex >= 2 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">Product catalog</h3>
          <SummaryRow label="Linked to" value={selectedCatalogName ?? '— not linked —'} />
        </section>
      ) : null}
    </>
  );
}
