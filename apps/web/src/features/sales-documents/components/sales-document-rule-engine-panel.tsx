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
 * single-primary model (`SalesDocumentsPanel`). Both surfaces stay on the
 * same page, clearly labelled, because the older resolver is still live and
 * reachable whenever a country has no rule-engine configuration.
 *
 * LAYOUT (#2806 — mockup alignment): the mockup's primary surface is exactly
 * two tables, "What each market issues" then "Connected providers", rendered
 * adjacent at the top of the page. This panel now composes both at the top
 * (`SalesDocumentMarketSection` + `SalesDocumentsPanel`) and moves every
 * other surface — the rule composer, starter templates, and the older
 * per-country `SalesDocumentCountryIndex` table — behind a closed-by-default
 * `<details>` disclosure below them. Nothing is removed; a country still
 * appearing in both the market table and the advanced per-country table is
 * expected (they answer different questions: "what happens right now" vs.
 * "how is that decided"), it is simply no longer the first thing an operator
 * sees.
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
import { useRef, useState, type ReactElement } from 'react';
import { SalesDocumentCountryIndex } from './sales-document-country-index';
import { SalesDocumentCountryRoutingDialog } from './sales-document-country-routing-dialog';
import { SalesDocumentMarketSection } from './sales-document-market-section';
import { SalesDocumentTemplateScreen } from './sales-document-template-screen';
import { SalesDocumentsPanel } from './sales-documents-panel';

interface RoutingDialogState {
  open: boolean;
  country: string;
  cameFrom: string | null;
}

const ADD_COUNTRY_INPUT_ID = 'sales-document-add-country-input';

export function SalesDocumentRuleEnginePanel(): ReactElement {
  const [routingDialog, setRoutingDialog] = useState<RoutingDialogState | null>(null);
  const advancedRef = useRef<HTMLDetailsElement>(null);

  function handleSelectCountry(selected: string): void {
    setRoutingDialog({ open: true, country: selected, cameFrom: null });
  }

  function handleNavigate(nextCountry: string, cameFrom: string | null): void {
    setRoutingDialog({ open: true, country: nextCountry, cameFrom });
  }

  function handleOpenChange(open: boolean): void {
    setRoutingDialog((prev) => (prev ? { ...prev, open } : prev));
  }

  // "Add a market" (mockup) reveals the advanced disclosure that still owns
  // the country-add flow, rather than duplicating a second country-entry
  // control — one input, one place it lives.
  function handleAddMarket(): void {
    if (advancedRef.current) advancedRef.current.open = true;
    requestAnimationFrame(() => {
      document.getElementById(ADD_COUNTRY_INPUT_ID)?.focus();
    });
  }

  return (
    <div className="page-section" style={{ marginTop: 'var(--space-6)' }}>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <p className="eyebrow">Sales documents</p>
        <h3 className="detail-section__title">What each market issues</h3>
        <p className="page-description">
          Legal responsibility for what a sale requires stays with the operator — OpenLinker
          executes the configured routing, it doesn&apos;t decide tax obligations.
        </p>
      </header>

      {/*
       * #2539/M6 — the settings page's headline: what does each market
       * issue, right now.
       */}
      <SalesDocumentMarketSection onSelectCountry={handleSelectCountry} />

      <div className="sales-document-add-market-row">
        <button type="button" className="button button--secondary button--sm" onClick={handleAddMarket}>
          Add a market
        </button>
      </div>

      {/*
       * #2806 — the mockup's second primary table, "Connected providers",
       * sits directly under the market table, never below the advanced
       * per-country editor.
       */}
      <SalesDocumentsPanel />

      <details ref={advancedRef} className="sales-document-advanced-disclosure">
        <summary className="sales-document-advanced-disclosure__summary">
          Advanced: per-country rules
        </summary>

        <div className="sales-document-advanced-disclosure__body">
          <p className="page-description">
            A rule is <span className="mono-text">conditions → document type → integration</span>,
            scoped to one country; no rule matched falls through to that country&apos;s default
            integration per document type.
          </p>

          <SalesDocumentCountryIndex onSelectCountry={handleSelectCountry} />

          {/* Only shown while nothing else is open, or while the operator is actually
              configuring PL — otherwise it's clutter on every other market's dialog
              (review finding, optional improvements). */}
          {routingDialog === null || routingDialog.country === 'PL' ? (
            <SalesDocumentTemplateScreen country="PL" />
          ) : null}
        </div>
      </details>

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
