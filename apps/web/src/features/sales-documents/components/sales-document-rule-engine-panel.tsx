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
 * WIRED TO AUTO-ISSUE (#2173): `AutoIssueTriggerService` consults
 * `evaluateSalesDocumentRules` FIRST, ahead of the #2156 operator-configured
 * single-primary model (`SalesDocumentsPanel`, rendered above this section on
 * the same page) — only a `'no-configuration-for-country'` result (or an
 * order the engine can't place at all) falls through to that older resolver.
 * Both surfaces stay on the same page, clearly labelled, because the older
 * resolver is still live and reachable whenever a country has no rule-engine
 * configuration.
 *
 * The shipped Poland starter template's `buyerHasTaxId` condition CANNOT
 * match a real order yet: `Order` carries no buyer-tax-id field, so the
 * mapper that feeds this engine always supplies `undefined` for it (see
 * `toSalesDocumentOrderFacts`'s own doc comment) — `undefined` matches
 * neither `true` nor `false`. `SalesDocumentRuleComposerDialog` surfaces this
 * as an inline warning wherever an operator authors that condition, rather
 * than only in a code comment nobody configuring a rule would ever read.
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

      {/* Only shown while nothing else is open, or while the operator is actually
          configuring PL — otherwise it's clutter on every other market's dialog
          (review finding, optional improvements). */}
      {routingDialog === null || routingDialog.country === 'PL' ? (
        <SalesDocumentTemplateScreen country="PL" />
      ) : null}

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
