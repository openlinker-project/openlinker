/**
 * Poland Starter Template — Sales-Document Rules (#2170)
 *
 * Poland-only curated seed content: sourced public guidance, an amount, and
 * the three rule SHAPES the mockup's "Review & adopt" screen previews. Ships
 * as DATA in `apps/api` — never as a literal string inside
 * `libs/core/src/sales-documents/**`, which is the acceptance criterion this
 * file exists to satisfy. No other country has a curated template yet; the
 * mechanism (`SalesDocumentTemplatesController`) is generic — a second
 * country's template is additive (another exported constant + one more
 * `TEMPLATES_BY_COUNTRY` entry), never a core code change.
 *
 * Each template rule names a `requiredCapability` rather than a fixed
 * `connectionId` — the operator has not chosen a connection yet at preview
 * time. "Review & adopt" resolves each slot against the operator's own
 * connections (client-side, from the same connections list the rest of this
 * feature already fetches) and POSTs the resolved `connectionId` per slot to
 * `/sales-documents/templates/PL/adopt`.
 *
 * @module apps/api/src/sales-documents/data
 */

export interface SalesDocumentTemplateCondition {
  readonly field: 'buyerHasTaxId' | 'orderCountry' | 'orderTotalGross';
  readonly op: 'eq' | 'gte' | 'lt';
  readonly value?: boolean | string;
  readonly thresholdRef?: string;
}

export interface SalesDocumentTemplateRule {
  /** Stable slot key the adopt request keys its per-slot connectionId selection on. */
  readonly slot: string;
  readonly conditions: readonly SalesDocumentTemplateCondition[];
  readonly documentKind: 'invoice' | 'fiscal-receipt';
  /** The capability a connection must declare to fill this slot. */
  readonly requiredCapability: 'Invoicing' | 'Fiscalization';
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly label: string;
}

export interface SalesDocumentStarterTemplate {
  readonly country: string;
  readonly sourceLabel: string;
  readonly sourceUrl: string;
  readonly disclaimer: string;
  readonly rules: readonly SalesDocumentTemplateRule[];
}

const POLAND_TEMPLATE: SalesDocumentStarterTemplate = {
  country: 'PL',
  sourceLabel: 'ksef.podatki.gov.pl',
  sourceUrl: 'https://ksef.podatki.gov.pl/',
  disclaimer:
    'This is not legal advice. OpenLinker is reporting what the cited source publicly documents, ' +
    'not deciding what your business needs — review every condition and threshold with your ' +
    'accountant before adopting. Nothing is active until you choose to adopt it.',
  rules: [
    {
      slot: 'no-tax-id',
      conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: false }],
      documentKind: 'fiscal-receipt',
      requiredCapability: 'Fiscalization',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      label: 'Customer has no tax ID → Receipt',
    },
    {
      slot: 'tax-id-below-threshold',
      conditions: [
        { field: 'buyerHasTaxId', op: 'eq', value: true },
        { field: 'orderTotalGross', op: 'lt', thresholdRef: 'pl-simplified-invoice-2026' },
      ],
      documentKind: 'fiscal-receipt',
      requiredCapability: 'Fiscalization',
      effectiveFrom: '2020-01-01',
      effectiveTo: '2026-12-31',
      label: 'Customer has tax ID and total ≤ 450 PLN → Receipt (+ tax ID)',
    },
    {
      slot: 'tax-id-above-threshold',
      conditions: [
        { field: 'buyerHasTaxId', op: 'eq', value: true },
        { field: 'orderTotalGross', op: 'gte', thresholdRef: 'pl-simplified-invoice-2026' },
      ],
      documentKind: 'invoice',
      requiredCapability: 'Invoicing',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      label: 'Customer has tax ID and total > 450 PLN → Invoice',
    },
  ],
};

const TEMPLATES_BY_COUNTRY: Readonly<Record<string, SalesDocumentStarterTemplate>> = {
  PL: POLAND_TEMPLATE,
};

/** `null` when no curated template exists for the given country (every country but Poland, today). */
export function getSalesDocumentStarterTemplate(country: string): SalesDocumentStarterTemplate | null {
  return TEMPLATES_BY_COUNTRY[country.toUpperCase()] ?? null;
}

export const SALES_DOCUMENT_TEMPLATE_PROVENANCE_BY_COUNTRY: Readonly<Record<string, string>> = {
  PL: 'PL starter template',
};
