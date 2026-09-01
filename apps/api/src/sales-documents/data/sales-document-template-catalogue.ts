/**
 * Sales-Document Starter-Template Catalogue (#2170, #2529)
 *
 * Country-keyed curated seed content: for each market we have researched
 * public guidance for, a citable source and the rule SHAPES the "Review &
 * adopt" screen previews. Poland is the only entry today.
 *
 * **Absence is a first-class answer, not silence** (ADR-066 decision 2). A
 * country with no entry resolves `null` from
 * {@link getSalesDocumentStarterTemplate} and is simply missing from
 * {@link listSalesDocumentTemplateCountries}, so a surface can state "we have
 * no guidance for this market" rather than presenting an empty template as
 * though one existed. Nothing here recommends, applies or activates anything:
 * reading the catalogue has no effect, and adoption is a separate explicit
 * write (`POST /sales-documents/templates/:country/adopt`).
 *
 * Ships as DATA in `apps/api` - never as a literal string inside
 * `libs/core/src/sales-documents/**`, which stays a zero-outbound-core-context
 * -edge leaf and carries no market-specific content. A second country's
 * template is additive: another exported constant plus one more
 * `TEMPLATES_BY_COUNTRY` entry, never a core code change.
 *
 * Each template rule names a `requiredCapability` rather than a fixed
 * `connectionId` - the operator has not chosen a connection yet at preview
 * time. "Review & adopt" resolves each slot against the operator's own
 * connections and POSTs the resolved `connectionId` per slot.
 *
 * @module apps/api/src/sales-documents/data
 * @see docs/architecture/adrs/066-sales-document-market-discovery.md
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

/**
 * ## What these rules do and do not fire on (#2599 review, finding 2)
 *
 * All three rules test `buyerHasTaxId`, which is a three-state fact: unknown,
 * known-absent, or a value. A rule testing `eq false` matches only the
 * known-absent state, never the unknown one, so an order whose source said
 * nothing about the buyer's tax id keeps falling through to the country
 * default exactly as it did before the fact was wired.
 *
 * That is what makes the wiring safe for an operator who already adopted this
 * template: a PrestaShop consumer order leaves `ps_address.vat_number` blank,
 * blank reads as unknown, and rule 1 does not fire. A B2B order carrying a
 * real tax id now matches rule 2 or 3, which is the behaviour an operator
 * adopting a template with these labels asked for.
 */
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

/** One catalogue entry, reduced to what a listing surface needs. */
export interface SalesDocumentTemplateSummary {
  readonly country: string;
  readonly sourceLabel: string;
  readonly sourceUrl: string;
}

/**
 * Every country a curated starter template exists for, alphabetically.
 *
 * The list is the whole answer: a country missing from it has no guidance,
 * which is a fact a surface may state. It never implies the market is
 * unsupported or misconfigured.
 */
export function listSalesDocumentTemplateCountries(): SalesDocumentTemplateSummary[] {
  return Object.values(TEMPLATES_BY_COUNTRY)
    .map((template) => ({
      country: template.country,
      sourceLabel: template.sourceLabel,
      sourceUrl: template.sourceUrl,
    }))
    .sort((a, b) => a.country.localeCompare(b.country));
}

/**
 * Whether a curated starter template exists for `country`. Case-insensitive on
 * the input, like {@link getSalesDocumentStarterTemplate}, so a country code
 * read off an order matches the catalogue's canonical upper-case keys.
 */
export function hasSalesDocumentStarterTemplate(country: string): boolean {
  return getSalesDocumentStarterTemplate(country) !== null;
}
