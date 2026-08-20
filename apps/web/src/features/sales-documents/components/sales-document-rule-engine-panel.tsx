/**
 * Sales-Document Rule Engine Panel (#2170, ADR-041 decision 5, narrowed)
 *
 * Composes the country index (#2187, replacing the free-text-plus-chips
 * `SalesDocumentCountrySelector`), the starter-template "Review & adopt"
 * screen (Poland only), and the per-country routing dialog (#2188) into the
 * "Settings → Sales documents" page's rule-engine section.
 *
 * A row's "Configure" action (and "Add country") reaches
 * `SalesDocumentCountryRoutingDialog` via `handleSelectCountry` — the country
 * defaults + rules list no longer render flat below the index (#2188 retires
 * that interim placeholder); they render exclusively inside the dialog now.
 * `handleNavigate` backs the dialog's own tier-3 cross-link (open ★ Rest of
 * world's dialog) and its "← Back to {country}" affordance, both of which
 * switch the dialog's country while it stays open.
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
import { SalesDocumentCountryIndex } from './sales-document-country-index';
import { SalesDocumentCountryRoutingDialog } from './sales-document-country-routing-dialog';
import { SalesDocumentTemplateScreen } from './sales-document-template-screen';

interface RoutingDialogState {
  open: boolean;
  country: string;
  cameFrom: string | null;
}

export function SalesDocumentRuleEnginePanel(): ReactElement {
  const [routingDialog, setRoutingDialog] = useState<RoutingDialogState | null>(null);

  function handleSelectCountry(selected: string): void {
    setRoutingDialog({ open: true, country: selected, cameFrom: null });
  }

  function handleNavigate(nextCountry: string, cameFrom: string | null): void {
    setRoutingDialog({ open: true, country: nextCountry, cameFrom });
  }

  function handleOpenChange(open: boolean): void {
    setRoutingDialog((prev) => (prev ? { ...prev, open } : prev));
  }

  return (
    <div className="page-section" style={{ marginTop: 'var(--space-6)' }}>
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

      <SalesDocumentTemplateScreen country="PL" />

      {routingDialog ? (
        <SalesDocumentCountryRoutingDialog
          open={routingDialog.open}
          country={routingDialog.country}
          cameFrom={routingDialog.cameFrom}
          onOpenChange={handleOpenChange}
          onNavigate={handleNavigate}
        />
      ) : null}
    </div>
  );
}
