/**
 * Sales-Document Rule Engine Panel (#2170, ADR-041 decision 5, narrowed)
 *
 * Composes the country index (#2187, replacing the free-text-plus-chips
 * `SalesDocumentCountrySelector`), the starter-template "Review & adopt"
 * screen (Poland only), the country defaults, and the rules list into the
 * "Settings → Sales documents" page's rule-engine section.
 *
 * NOT YET WIRED TO AUTO-ISSUE (documented, not hidden): `AutoIssueTriggerService`
 * still resolves via the #2156 operator-configured single-primary model
 * (`SalesDocumentsPanel`, rendered above this section on the same page) —
 * rewiring the trigger to consult this rule engine is a follow-up this issue
 * does not claim ("this issue should land the mechanism but cannot claim the
 * Poland template is live until the order contract carries the field").
 * Removing the still-live configuration surface to make room for this one
 * would leave operators unable to configure what the backend actually acts
 * on today, so both surfaces render on the same page, clearly labelled.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { SalesDocumentCountryIndex } from './sales-document-country-index';
import { SalesDocumentCountryDefaults } from './sales-document-country-defaults';
import { SalesDocumentRulesList } from './sales-document-rules-list';
import { SalesDocumentTemplateScreen } from './sales-document-template-screen';
import { useSalesDocumentRulesQuery } from '../hooks/use-sales-document-rules-query';
import { useSalesDocumentCountryDefaultsQuery } from '../hooks/use-sales-document-country-defaults-query';

export function SalesDocumentRuleEnginePanel(): ReactElement {
  const [country, setCountry] = useState('PL');
  const rulesQuery = useSalesDocumentRulesQuery(country);
  const defaultsQuery = useSalesDocumentCountryDefaultsQuery(country);

  // TODO(#2188): a row's "Configure" action (and "Add country") is meant to
  // open a per-country routing dialog. That dialog doesn't exist yet, so in
  // the interim this just selects the country and keeps driving the
  // country-scoped sections rendered below the index with it.
  function handleSelectCountry(selected: string): void {
    setCountry(selected);
  }

  const isUnconfigured =
    !rulesQuery.isLoading &&
    !defaultsQuery.isLoading &&
    (rulesQuery.data ?? []).length === 0 &&
    (defaultsQuery.data ?? []).length === 0;

  return (
    <div className="page-section">
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <p className="eyebrow">Per-country rules</p>
        <h3 className="detail-section__title">Sales-document rule engine</h3>
        <p className="page-description">
          A rule is <span className="mono-text">conditions → document type → integration</span>,
          scoped to one country; no rule matched falls through to that country&apos;s default
          integration per document type. Legal responsibility for what a sale requires stays with
          the operator — OpenLinker executes the configured routing, it doesn&apos;t decide tax
          obligations.
        </p>
      </header>

      <SalesDocumentCountryIndex onSelectCountry={handleSelectCountry} />

      <SalesDocumentTemplateScreen country={country} />

      {isUnconfigured ? (
        <Alert
          tone="warning"
          title={`${country === '*' ? '★ Rest of world' : country} has no defaults and no rules yet`}
        >
          Until at least one default is set, an order billed here with no matching rule falls
          through to <span className="mono-text">★ Rest of world</span> if that&apos;s configured,
          or is reported <span className="mono-text">unresolved</span> otherwise. Set a default to
          start.
        </Alert>
      ) : null}

      <SalesDocumentCountryDefaults country={country} />
      <SalesDocumentRulesList country={country} />
    </div>
  );
}
