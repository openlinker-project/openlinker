/**
 * Sales-Document Rule Engine Panel (#2170, ADR-041 decision 5, narrowed)
 *
 * Composes the market list (#2540/#2542, filtered — see below), the
 * starter-template "Review & adopt" screen (Poland only), and the
 * per-country routing dialog (#2188) into the "Settings → Sales documents"
 * page's rule-engine section.
 *
 * A row's action (and "Add a market") reaches
 * `SalesDocumentCountryRoutingDialog` via `handleSelectCountry` — the country
 * defaults + rules list render exclusively inside the dialog. `handleNavigate`
 * backs the dialog's own tier-3 cross-link (open ★ Rest of world's dialog)
 * and its "← Back to {country}" affordance, both of which switch the
 * dialog's country while it stays open.
 *
 * WIRED TO AUTO-ISSUE (#2173, fallback retired — "opcja b" decision):
 * `AutoIssueTriggerService` consults `evaluateSalesDocumentRules` ONLY. The
 * pre-#2170 operator-configured single-primary model
 * (`config.invoicing.isPrimary`) is no longer consulted at all — a country
 * with no rule-engine configuration always resolves to manual, never to a
 * connection picked via `isPrimary`. The old "Connected providers" page that
 * edited that flag is retired; there is nothing left for it to configure.
 *
 * ONE LIST, NOT TWO (#2806 review, second pass): this used to compose the
 * market section ABOVE a second, separate `SalesDocumentCountryIndex` table
 * behind an "Advanced: per-country rules" disclosure — two lists that both
 * opened the identical routing dialog for the identical underlying config,
 * reading as duplicate functionality to an operator ("why are there two
 * places to set the same country up?"). They always were the same data
 * wearing two UIs: `GET /sales-documents/markets` already unions "has recent
 * orders" and "is configured" countries server-side (a country appears once,
 * however it qualified — see that controller's own doc comment), which is
 * exactly what made the second `/sales-documents/countries` read and its
 * table redundant. `SalesDocumentMarketSection` now renders every country
 * from that ONE read, with filter chips ("All" / "Recent orders" /
 * "Configured, no recent orders" / "Needs a decision") standing in for what
 * used to be two separate page sections. `SalesDocumentCountryIndex` and its
 * backing query are retired — nothing else consumed them.
 *
 * The Poland starter template now renders INSIDE `SalesDocumentCountryRoutingDialog`
 * itself (moved off this page, review finding): it was previously a standalone
 * block below the market list, disconnected from PL's own configuration
 * dialog — an operator opening "Configure" on PL saw the ordinary empty-rules
 * dialog, then had to scroll past it on the page to find the suggested
 * template. It now appears where the operator actually is when deciding how
 * to configure PL.
 *
 * The shipped Poland starter template's `buyerHasTaxId` condition matches
 * ONLY orders from sources that actually assert a buyer tax id (#2599) —
 * PrestaShop, today. Allegro and WooCommerce orders never carry the fact
 * (see `order-to-sales-document-order-facts.mapper.ts`'s own doc comment;
 * tracked to close for both in #2822), so a rule using it silently falls
 * through to the next tier for those orders rather than matching or
 * erroring. `SalesDocumentRuleComposerDialog` surfaces this as an inline
 * warning wherever an operator authors that condition, rather than only in
 * a code comment nobody configuring a rule would ever read.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { Combobox, type ComboboxOption } from '../../../shared/ui/combobox';
import { ISO_3166_1_COUNTRIES } from '../../../shared/lib/iso-3166-1-countries';
import { SalesDocumentCountryRoutingDialog } from './sales-document-country-routing-dialog';
import { SalesDocumentMarketSection } from './sales-document-market-section';
import { useSalesDocumentMarketsQuery } from '../hooks/use-sales-document-markets-query';
import { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY } from '../api/sales-document-rules.types';

interface RoutingDialogState {
  open: boolean;
  country: string;
  cameFrom: string | null;
}

export function SalesDocumentRuleEnginePanel(): ReactElement {
  const [routingDialog, setRoutingDialog] = useState<RoutingDialogState | null>(null);
  const [draftCountry, setDraftCountry] = useState<string | null>(null);
  const marketsQuery = useSalesDocumentMarketsQuery();

  function handleSelectCountry(selected: string): void {
    setRoutingDialog({ open: true, country: selected, cameFrom: null });
  }

  function handleNavigate(nextCountry: string, cameFrom: string | null): void {
    setRoutingDialog({ open: true, country: nextCountry, cameFrom });
  }

  function handleOpenChange(open: boolean): void {
    setRoutingDialog((prev) => (prev ? { ...prev, open } : prev));
  }

  // Review finding: a free-text "Country code, e.g. IT" input let an
  // operator mistype or fabricate a code — the market row it opens is keyed
  // by that exact string, so a typo silently creates a market no real order
  // can ever reach. A real ISO 3166-1 dictionary makes an invalid code
  // unreachable through the UI at all, and a country already in the list
  // above is disabled here (still visible, so the operator can see it
  // already exists) rather than letting "Add a market" open a second,
  // confusing entry point to the same row.
  const existingCountries = useMemo(
    () => new Set((marketsQuery.data?.markets ?? []).map((market) => market.country)),
    [marketsQuery.data],
  );
  const countryOptions: ComboboxOption[] = useMemo(
    () =>
      ISO_3166_1_COUNTRIES.map((country) => ({
        id: country.code,
        label: country.name,
        hint: country.code,
        disabled: existingCountries.has(country.code),
        disabledReason: 'Already in the list above',
      })),
    [existingCountries],
  );

  // A country not yet in the list (no orders, no config) has nowhere to
  // click yet — picking it here opens the SAME routing dialog every row's
  // action does, pre-scoped to it. Once something is actually saved there,
  // it joins the list above on its own. The dictionary already disables an
  // existing country, but that's a UI convenience, not the guard: even a
  // DOM-tampered submit lands on `handleSelectCountry`, which only ever
  // OPENS the existing dialog for that country — there is no separate
  // "create a market" write this could duplicate. A market row is a
  // read projection over rules/defaults keyed by country, not a row of its
  // own, so there is nothing here for a hacked value to duplicate.
  function submitAddMarket(): void {
    if (draftCountry === null) return;
    setDraftCountry(null);
    handleSelectCountry(draftCountry);
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
       * #2539/M6/#2806 — the settings page's one list: what does each market
       * issue right now, filterable by why it's showing up.
       */}
      <SalesDocumentMarketSection onSelectCountry={handleSelectCountry} />

      <div className="sales-document-add-market-row">
        <Combobox
          ariaLabel="New market country"
          className="sales-document-add-market-row__input"
          options={countryOptions}
          value={draftCountry ? { kind: 'dictionary', ids: [draftCountry] } : null}
          onChange={(next) =>
            setDraftCountry(next?.kind === 'dictionary' ? (next.ids[0] ?? null) : null)
          }
          placeholder="Search a country…"
        />
        <Button
          tone="secondary"
          className="button--sm"
          disabled={draftCountry === null}
          onClick={submitAddMarket}
        >
          Add a market
        </Button>
      </div>

      {/*
       * Review finding: ★ Rest of world never has orders of its own, so it
       * never appears as a row in the market list above — the only way in
       * was typing the undiscoverable "*" into the input above, or stumbling
       * onto another country's tier-3 cross-link. This is its own row, the
       * same visual weight as a real market, so it reads as a first-class
       * catch-all rather than a hidden shortcut.
       */}
      <div className="sales-document-rest-of-world-row">
        <div>
          <p className="sales-document-rest-of-world-row__title">★ Rest of world</p>
          <p className="muted-text">
            The catch-all every unconfigured market above falls through to.
          </p>
        </div>
        <Button
          tone="secondary"
          className="button--sm"
          onClick={() => handleSelectCountry(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY)}
        >
          Configure →
        </Button>
      </div>

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
