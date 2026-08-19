/**
 * Sales-Document Country Summary Type (#2186)
 *
 * The shape `listConfiguredCountries` returns: one row per country carrying
 * ANY rule, country default, or no-document acknowledgment. A country
 * missing one side is never dropped from the list — `ruleCount` defaults to
 * `0`, `invoiceDefaultConnectionId` / `receiptDefaultConnectionId` default to
 * `null` rather than the row being omitted.
 *
 * The two default fields are named after the two `CoreSalesDocumentKind`
 * values (`sales-document-kind.types.ts`) rather than an open-ended map,
 * mirroring the issue's own proposed shape — a country default is only ever
 * authored for `invoice` or `fiscal-receipt` today.
 *
 * `acknowledgedNoDocumentAt` is an ISO-8601 string (never a `Date`) so this
 * type stays a plain wire-shaped value, matching the read-side
 * `*-order-facts.types.ts` convention of not leaking `Date` into a
 * projection meant to cross the service boundary.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
export interface SalesDocumentCountrySummary {
  /** ISO 3166-1 alpha-2, or `*` for Rest of world. */
  readonly country: string;
  /** How many `sales_document_rules` rows target this country. */
  readonly ruleCount: number;
  /** The country's `invoice` tier-2 default connection, or `null` if unset. */
  readonly invoiceDefaultConnectionId: string | null;
  /** The country's `fiscal-receipt` tier-2 default connection, or `null` if unset. */
  readonly receiptDefaultConnectionId: string | null;
  /**
   * When the country was acknowledged as "no document, by design", or
   * `null` if never acknowledged (or since cleared). Informational only —
   * see `SalesDocumentCountryAcknowledgment`'s own doc comment.
   */
  readonly acknowledgedNoDocumentAt: string | null;
}
