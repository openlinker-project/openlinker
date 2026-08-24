/**
 * Sales-Document Country Index (#2187)
 *
 * Replaces the free-text-plus-chips `SalesDocumentCountrySelector` with a
 * scannable "everything you've configured, at a glance" table, sourced from
 * `useSalesDocumentCountriesQuery` (the #2186 `GET /sales-documents/countries`
 * read). Reuses the `.data-table` / `.data-table__container` classes
 * `SalesDocumentsPanel` already styles — no new table styling.
 *
 * `★ Rest of world` always renders last (see `orderSalesDocumentCountries`)
 * with an additional "Always on · catch-all" badge, on top of whichever of
 * the three ordinary status states applies — it is a real, configurable
 * country like any other, just one that is never allowed to sort anywhere
 * but the bottom and is always visually called out.
 *
 * Row-level "Configure" and the "Add country" affordance both resolve to
 * `onSelectCountry` — clicking either opens the per-country routing dialog
 * (`SalesDocumentCountryRoutingDialog`, #2188) via `SalesDocumentRuleEnginePanel`.
 * Both affordances reach that single callback in exactly one click past
 * typing a code, so an unconfigured/new country costs no more clicks than a
 * configured one.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ReactElement } from 'react';
import { useConnectionsQuery } from '../../connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useSalesDocumentCountriesQuery } from '../hooks/use-sales-document-countries-query';
import { deriveSalesDocumentCountryStatus } from '../lib/derive-sales-document-country-status';
import { orderSalesDocumentCountries } from '../lib/order-sales-document-countries';
import {
  SALES_DOCUMENT_REST_OF_WORLD_COUNTRY,
  type SalesDocumentCountrySummary,
} from '../api/sales-document-rules.types';

interface SalesDocumentCountryIndexProps {
  /**
   * Called with a country code when an existing row's "Configure" action is
   * clicked, or a freshly-typed code is submitted via "Add country". See the
   * module doc comment — this is a placeholder seam for #2188's dialog.
   */
  onSelectCountry: (country: string) => void;
}

function countryLabel(country: string): string {
  return country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY ? '★ Rest of world' : country;
}

export function SalesDocumentCountryIndex({
  onSelectCountry,
}: SalesDocumentCountryIndexProps): ReactElement {
  const countriesQuery = useSalesDocumentCountriesQuery();
  const connectionsQuery = useConnectionsQuery();
  const [draftCountry, setDraftCountry] = useState('');

  if (countriesQuery.isLoading || connectionsQuery.isLoading) {
    return (
      <LoadingState
        title="Loading countries"
        message="Fetching every country with sales-document configuration…"
      />
    );
  }

  if (countriesQuery.error || connectionsQuery.error) {
    return (
      <ErrorState
        title="Unable to load countries"
        message={(countriesQuery.error ?? connectionsQuery.error)?.message ?? 'Unknown error'}
      />
    );
  }

  const connections = connectionsQuery.data ?? [];
  const connectionName = (connectionId: string | null): ReactElement => {
    if (connectionId === null) return <EmptyValue label="No default set" />;
    const name = connections.find((c) => c.id === connectionId)?.name ?? connectionId;
    return <span>{name}</span>;
  };

  const rows = orderSalesDocumentCountries(countriesQuery.data ?? []);

  function submitAddCountry(): void {
    const normalized = draftCountry.trim().toUpperCase();
    if (normalized.length === 0) return;
    setDraftCountry('');
    onSelectCountry(
      normalized === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY.toUpperCase()
        ? SALES_DOCUMENT_REST_OF_WORLD_COUNTRY
        : normalized,
    );
  }

  return (
    <div className="page-section sales-document-country-index">
      <div className="data-table__container">
        <table className="data-table" aria-label="Sales-document country index">
          <caption className="sr-only">
            Every country carrying sales-document rules, defaults, or a no-document acknowledgment
          </caption>
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">Rules</th>
              <th scope="col">Invoice defaults to</th>
              <th scope="col">Receipt defaults to</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: SalesDocumentCountrySummary) => {
              const isRestOfWorld = row.country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY;
              const badge = deriveSalesDocumentCountryStatus(row);
              return (
                <tr key={row.country}>
                  <td>
                    <span className="mono-text">{countryLabel(row.country)}</span>
                  </td>
                  <td>{row.ruleCount}</td>
                  <td>{connectionName(row.invoiceDefaultConnectionId)}</td>
                  <td>{connectionName(row.receiptDefaultConnectionId)}</td>
                  <td>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--space-2)',
                        alignItems: 'center',
                      }}
                    >
                      <StatusBadge tone={badge.tone} withDot={badge.withDot} compact>
                        {badge.label}
                      </StatusBadge>
                      {isRestOfWorld ? (
                        <StatusBadge tone="info" compact>
                          Always on · catch-all
                        </StatusBadge>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <Button
                      tone="secondary"
                      className="button--sm"
                      onClick={() => onSelectCountry(row.country)}
                    >
                      Configure
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <Alert tone="info" title="No countries configured yet">
          Add a country below to start setting up its rules and defaults.
        </Alert>
      ) : null}

      <div className="sales-document-country-index__add-row">
        <label className="eyebrow" htmlFor="sales-document-add-country-input">
          Add country
        </label>
        <div className="sales-document-country-index__add-row-controls">
          <Input
            id="sales-document-add-country-input"
            value={draftCountry}
            placeholder="e.g. DE"
            maxLength={8}
            aria-label="New country ISO code"
            onChange={(event) => setDraftCountry(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              submitAddCountry();
            }}
          />
          <Button tone="secondary" className="button--sm" onClick={submitAddCountry}>
            Add
          </Button>
        </div>
        <p className="muted-text">
          Type any ISO 3166-1 alpha-2 country code not already listed above, or{' '}
          <span className="mono-text">*</span> for <span className="mono-text">★ Rest of world</span>{' '}
          — the rule-building mechanism is fully country-agnostic.
        </p>
      </div>
    </div>
  );
}
