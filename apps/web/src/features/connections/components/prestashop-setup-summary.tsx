/**
 * PrestashopSetupSummary
 *
 * Live-bound read-only summary panel for the PrestaShop connection wizard.
 * Surfaces the identity fields the operator has entered so far and swaps
 * in per-step supplemental content (verify note on step 1, capability
 * list on steps 2-3). Secrets (webservice key) are intentionally omitted
 * — they're already masked in the inline verify/review DLs and should
 * not be duplicated into a persistent side panel.
 *
 * @see {@link PrestashopSetupForm} for the form this summary is paired with.
 */
import type { ReactElement } from 'react';
import { EmptyValue } from '../../../shared/ui/empty-value';
import type { PrestashopSetupFormValues } from './prestashop-setup.schema';

interface PrestashopSetupSummaryProps {
  values: PrestashopSetupFormValues;
  stepIndex: number;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
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

export function PrestashopSetupSummary({
  stepIndex,
  values,
}: PrestashopSetupSummaryProps): ReactElement {
  const webserviceEndpoint =
    values.baseUrl && values.baseUrl.length > 0 ? `${trimTrailingSlash(values.baseUrl)}/api` : null;
  const selectedCapabilities = values.enabledCapabilities ?? [];

  return (
    <>
      <section className="wizard-summary__section">
        <h3 className="wizard-summary__section-title">Connection</h3>
        <SummaryRow label="Name" value={values.name?.trim() ? values.name : null} />
        <SummaryRow label="Webservice endpoint" value={webserviceEndpoint} mono />
        <SummaryRow
          label="Storefront URL"
          value={values.storefrontBaseUrl ? values.storefrontBaseUrl : null}
          mono
        />
        <SummaryRow label="Shop ID" value={values.shopId ? values.shopId : null} mono />
        <SummaryRow
          label="Default currency"
          value={values.currency ? values.currency : null}
          mono
        />
      </section>

      {stepIndex === 1 ? (
        <p className="wizard-summary__note">
          Live test available after the connection is saved — see the connection detail page.
        </p>
      ) : null}

      {stepIndex >= 2 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">Capabilities</h3>
          {selectedCapabilities.length > 0 ? (
            <ul className="wizard-summary__capabilities">
              {selectedCapabilities.map((capability) => (
                <li key={capability} className="wizard-summary__capability mono-text">
                  {capability}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyValue label="No capabilities selected" />
          )}
        </section>
      ) : null}
    </>
  );
}
