/**
 * Sales-Document Country Routing Dialog (#2188)
 *
 * Per-country routing configuration, relocated out of the flat page layout
 * (#2170's interim state) and into a Radix `Dialog` opened from a row in the
 * country index (#2187). The body composes, UNCHANGED, the two already-shipped
 * components — `SalesDocumentRulesList` (rule cards + "+ Add rule", which
 * already opens `SalesDocumentRuleComposerDialog` and surfaces the real server
 * 409 conflict) and `SalesDocumentCountryDefaults` (Invoice/Receipt default
 * pickers). Neither component's own logic is touched here — this dialog only
 * decides WHERE they render and what surrounds them.
 *
 * Fallback ladder, rendered as numbered tiers:
 *
 *   1. Rules            — `SalesDocumentRulesList`
 *   2. Country default   — `SalesDocumentCountryDefaults` (+ a dual-default
 *                          warning `Alert` when both Invoice and Receipt
 *                          defaults are set — an open resolution question,
 *                          not something to silently accept)
 *   3. Falls through to ★ Rest of world — a cross-link that opens ★ Rest of
 *      world's OWN dialog (`onNavigate`, carrying `cameFrom` so that dialog
 *      can render a "← Back to {country}" affordance)
 *   4. Unresolved (terminal)
 *
 * ★ Rest of world is the catch-all itself, so its OWN dialog renders only
 * tiers 1, 2, and the terminal tier renumbered to 3 — it never references
 * itself via tier 3's cross-link, and the two document-listed cases
 * (isRestOfWorld / not) are the only two shapes this component ever renders:
 * exactly 3 tiers or exactly 4, always sequentially numbered, never a
 * duplicate number. (A prior design-review round of the source mockup shipped
 * a real bug here — two tiers both labeled "Tier 2" — which is why the tier
 * list below is built as a single array and numbered by array index, not by a
 * hand-maintained literal per tier.)
 *
 * @module apps/web/src/features/sales-documents/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/ui/dialog';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useSalesDocumentCountryDefaultsQuery } from '../hooks/use-sales-document-country-defaults-query';
import { SalesDocumentRulesList } from './sales-document-rules-list';
import { SalesDocumentCountryDefaults } from './sales-document-country-defaults';
import { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY } from '../api/sales-document-rules.types';

export interface SalesDocumentCountryRoutingDialogProps {
  open: boolean;
  /** ISO 3166-1 alpha-2 code, or `SALES_DOCUMENT_REST_OF_WORLD_COUNTRY` ('*'). */
  country: string;
  /**
   * The country this dialog was opened FROM via the tier-3 cross-link, or
   * `null` when opened directly from the country index. Only ever set for
   * ★ Rest of world's own dialog — drives the "← Back to {country}"
   * affordance.
   */
  cameFrom: string | null;
  onOpenChange: (open: boolean) => void;
  /**
   * Switch the dialog to a different country while it stays open — used by
   * both the tier-3 cross-link (`onNavigate('*', country)`) and the back
   * affordance (`onNavigate(cameFrom, null)`).
   */
  onNavigate: (country: string, cameFrom: string | null) => void;
}

interface RoutingTier {
  key: string;
  title: string;
  content: ReactNode;
}

function countryDisplayName(country: string): string {
  return country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY ? '★ Rest of world' : country;
}

export function SalesDocumentCountryRoutingDialog({
  open,
  country,
  cameFrom,
  onOpenChange,
  onNavigate,
}: SalesDocumentCountryRoutingDialogProps): ReactElement {
  const isRestOfWorld = country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY;
  const defaultsQuery = useSalesDocumentCountryDefaultsQuery(country);
  const defaults = defaultsQuery.data ?? [];
  const hasDualDefault =
    defaults.some((d) => d.documentKind === 'invoice') &&
    defaults.some((d) => d.documentKind === 'fiscal-receipt');

  const displayName = countryDisplayName(country);

  const tiers: RoutingTier[] = [
    {
      key: 'rules',
      title: 'Rules',
      content: <SalesDocumentRulesList country={country} />,
    },
    {
      key: 'country-default',
      title: 'Country default',
      content: (
        <>
          <SalesDocumentCountryDefaults country={country} />
          {hasDualDefault ? (
            <Alert tone="warning" title="Both an Invoice and a Receipt default are set">
              {displayName} has both an Invoice default and a Receipt default configured. Which
              one applies depends entirely on which rule (or manual action) decides the document
              kind for a given order — confirm this is the intended configuration, since nothing
              here decides between them automatically.
            </Alert>
          ) : null}
        </>
      ),
    },
  ];

  if (!isRestOfWorld) {
    tiers.push({
      key: 'rest-of-world',
      title: 'Falls through to ★ Rest of world',
      content: (
        <div>
          <p className="muted-text">
            An order billed to {displayName} that matches no rule above and has no country
            default here falls through to <span className="mono-text">★ Rest of world</span>
            &apos;s own rules and defaults.
          </p>
          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => onNavigate(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY, country)}
          >
            Open ★ Rest of world&apos;s routing →
          </Button>
        </div>
      ),
    });
  }

  tiers.push({
    key: 'unresolved',
    title: 'Unresolved',
    content: (
      <p className="muted-text">
        {isRestOfWorld
          ? 'If nothing above matches, the order has no configured fallback left and is reported unresolved.'
          : `If ★ Rest of world also has no matching rule or default, the order is reported unresolved.`}
      </p>
    ),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="dialog__content--wide">
        {cameFrom ? (
          <Button
            tone="ghost"
            className="button--sm sales-document-country-routing-dialog__back"
            onClick={() => onNavigate(cameFrom, null)}
          >
            ← Back to {cameFrom}
          </Button>
        ) : null}

        <DialogTitle>Sales-document routing · {displayName}</DialogTitle>

        {tiers.map((tier, index) => (
          <section key={tier.key} className="page-section">
            <h3 className="detail-section__title">
              Tier {index + 1} · {tier.title}
            </h3>
            {tier.content}
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
