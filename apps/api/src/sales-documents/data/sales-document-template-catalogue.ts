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
  /** Decimal string; present only on an `orderTotalGross` condition (#3189). */
  readonly amount?: string;
  /** ISO 4217; present only on an `orderTotalGross` condition (#3189). */
  readonly currency?: string;
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
 * ## What these rules do and do not fire on
 *
 * Every rule tests `buyerHasTaxId`, a THREE-state fact: unknown, known-absent,
 * or a value. All of them test `eq true`, so they fire only on an order whose
 * source actually reported a tax number; anything else falls through to the
 * country default, which is what issues a receipt to a consumer.
 *
 * **A fourth rule used to sit at the top of this list and could never fire**
 * (#3224 / #3188 review, removed by #3189). It read
 * `{ field: 'buyerHasTaxId', op: 'eq', value: false }` under the label
 * "Customer has no tax ID -> Receipt", and `eq false` matches ONLY the
 * known-absent state - which `readSourceBuyerTaxId` structurally cannot
 * produce, and which no shipped order-source adapter writes. So an operator
 * adopting the flagship template got a rule that promised to work and matched
 * nothing, while the country default quietly did the job it claimed.
 *
 * It is not replaced by a widened operator. Separating "has none" from "we
 * were not told" is a deliberate #2599 decision with a legal motivation - a
 * fiscal document is a legal event for the seller, so that side of the
 * ambiguity fails to unknown - and a `notPresent` operator matching both would
 * reverse it and needs an amendment to ADR-063 / ADR-073, not a template edit.
 * When an adapter can positively report "this buyer has no tax id", a rule on
 * it becomes expressible and can be added back.
 *
 * ## Two currencies, two rules
 *
 * Polish law names the simplified-invoice ceiling as 450 zl **or** 100 euro,
 * and a currency never converts here (ADR-041, kept by #3189) - so a
 * euro-priced order matches only the EUR pair and a zloty-priced one only the
 * PLN pair. Before inline amounts this was inexpressible and a euro-priced
 * order delivered to Poland matched no rule at all.
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
      slot: 'tax-id-below-threshold',
      conditions: [
        { field: 'buyerHasTaxId', op: 'eq', value: true },
        { field: 'orderTotalGross', op: 'lt', amount: '450.00', currency: 'PLN' },
      ],
      documentKind: 'fiscal-receipt',
      requiredCapability: 'Fiscalization',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      label: 'Customer has tax ID and total under 450 PLN → Receipt (+ tax ID)',
    },
    {
      slot: 'tax-id-above-threshold',
      conditions: [
        { field: 'buyerHasTaxId', op: 'eq', value: true },
        { field: 'orderTotalGross', op: 'gte', amount: '450.00', currency: 'PLN' },
      ],
      documentKind: 'invoice',
      requiredCapability: 'Invoicing',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      label: 'Customer has tax ID and total 450 PLN or more → Invoice',
    },
    {
      slot: 'tax-id-below-threshold-eur',
      conditions: [
        { field: 'buyerHasTaxId', op: 'eq', value: true },
        { field: 'orderTotalGross', op: 'lt', amount: '100.00', currency: 'EUR' },
      ],
      documentKind: 'fiscal-receipt',
      requiredCapability: 'Fiscalization',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      label: 'Customer has tax ID and total under 100 EUR → Receipt (+ tax ID)',
    },
    {
      slot: 'tax-id-above-threshold-eur',
      conditions: [
        { field: 'buyerHasTaxId', op: 'eq', value: true },
        { field: 'orderTotalGross', op: 'gte', amount: '100.00', currency: 'EUR' },
      ],
      documentKind: 'invoice',
      requiredCapability: 'Invoicing',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      label: 'Customer has tax ID and total 100 EUR or more → Invoice',
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
