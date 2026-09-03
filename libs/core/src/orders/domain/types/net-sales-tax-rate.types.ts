/**
 * Net-Sales Tax-Rate Resolution
 *
 * The pure rule for turning one `order_line_items.taxRate` value into what a
 * NET-SALES (VAT-exclusive) aggregate needs: either a known rate fraction, or
 * an explicit "unknown" outcome that the caller must exclude rather than
 * silently zero (ADR-063 § Consequences — a pre-rollout / unresolvable rate
 * "issues exactly as it does today" and must never be presented as a
 * confirmed rate).
 *
 * This deliberately MIRRORS rather than imports
 * `@openlinker/core/invoicing`'s `tax-rate-notation.types.ts`
 * (`taxRatePercentToFraction` et al.): those functions are plain functions
 * that match none of the cross-context-import allow-list shapes
 * (`docs/architecture-overview.md § Cross-context dependencies in core`), and
 * their semantics differ anyway — invoicing returns `null` for an exemption
 * code (`'zw'/'np'/'oo'`) because it never computes with the rate, while
 * net-sales needs those same three codes to resolve to a KNOWN 0% fraction
 * (net = gross for that line). A read-model aggregate must also never throw
 * on one malformed historical row, unlike invoicing's
 * `FractionalTaxRateNotationError`-throwing helper — this resolver degrades
 * to `unknown` instead.
 *
 * @module libs/core/src/orders/domain/types
 * @see docs/architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md
 *
 * COUPLED NOTATION RULE (#1985 review): the fractional-notation bound below
 * (numeric, strictly between 0 and 1, rejected as `unknown`) must track
 * invoicing's `tax-rate-notation.types.ts#isFractionalTaxRateNotation`
 * exactly, even though this file deliberately does not import it. If
 * invoicing ever widens that bound (e.g. to accept `'0.23'`), this resolver
 * must be updated in the same commit - otherwise it silently keeps excluding
 * orders that invoicing would now accept, with no error surfaced anywhere.
 */
import type { PriceTaxTreatment } from './order.types';

/**
 * Non-numeric `order_line_items.taxRate` codes that carry an effective 0% VAT
 * rate for net-sales arithmetic (net = gross for such a line). Closed list,
 * mirroring `TaxRateEraValues`'s closed-list-with-guard convention — a future
 * unrecognized non-numeric code must read as `unknown` (excluded from net
 * figures), never be silently coerced to 0%.
 */
export const NetSalesExemptTaxRateCodeValues = ['zw', 'np', 'oo'] as const;
export type NetSalesExemptTaxRateCode = (typeof NetSalesExemptTaxRateCodeValues)[number];

/**
 * The result of resolving one `taxRate` value for net-sales arithmetic.
 * `'unknown'` means "exclude this line/order from every net figure" — it is
 * never coerced to a rate of `0`, which would silently claim a fact ("this
 * line carries no VAT") the data does not support.
 */
export type NetSalesTaxRateOutcome =
  | { kind: 'known'; rateFraction: number }
  | { kind: 'unknown' };

/**
 * Resolve one `order_line_items.taxRate` value to a net-sales rate fraction.
 *
 * - `null` / `undefined` / empty / whitespace-only -> `unknown` (never read).
 * - One of {@link NetSalesExemptTaxRateCodeValues} -> `known`, fraction `0`.
 * - A numeric percent in `[0, 100]` -> `known`, fraction `percent / 100`.
 * - Anything else (fractional notation like `'0.23'`, out-of-range, garbage)
 *   -> `unknown`. Never throws — this runs over historical data at read time,
 *   not at the write-time validation boundary that owns rejecting bad input.
 */
export function resolveNetSalesTaxRate(
  taxRate: string | null | undefined
): NetSalesTaxRateOutcome {
  if (taxRate == null) {
    return { kind: 'unknown' };
  }
  const trimmed = taxRate.trim();
  if (trimmed === '') {
    return { kind: 'unknown' };
  }
  if ((NetSalesExemptTaxRateCodeValues as readonly string[]).includes(trimmed)) {
    return { kind: 'known', rateFraction: 0 };
  }
  // Require the same numeric shape the SQL half enforces
  // (`~ '^[0-9]+(\.[0-9]+)?$'`) before converting to a number.
  // `Number.parseFloat` is prefix-lenient - it reads '0x10' as `0` and
  // '23,5' as `23`, silently confirming a rate for a value the SQL
  // predicate would reject outright as `NULL` - exactly the "0% VAT" false
  // claim this file's contract forbids. Anything not matching this shape
  // resolves to `unknown`, same as the SQL predicate; `Number()` is used
  // afterwards rather than `parseFloat` so nothing with trailing garbage
  // past a leading number can slip through even once the shape is confirmed.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'unknown' };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { kind: 'unknown' };
  }
  // Reject fractional notation (e.g. '0.23') the same way
  // `isFractionalTaxRateNotation` does in invoicing — ambiguous with a
  // genuine 0.23% rate, so treated as unresolvable rather than guessed.
  if (parsed > 0 && parsed < 1) {
    return { kind: 'unknown' };
  }
  if (parsed < 0 || parsed > 100) {
    return { kind: 'unknown' };
  }
  return { kind: 'known', rateFraction: parsed / 100 };
}

/**
 * Derive one line's VAT-exclusive amount for net-sales aggregates.
 *
 * - `'exclusive'`: `unitPrice` is already net — return `unitPrice × quantity`.
 * - `'inclusive'` or absent: treat `unitPrice` as gross and strip VAT via the
 *   resolved rate fraction; return `null` when the rate is unresolvable.
 *
 * A gross price already includes the tax on top of net (`gross = net × (1 +
 * rate)`), so recovering net divides by `(1 + rate)` — it does NOT multiply
 * by `(1 - rate)`, which is a different (and wrong) computation that
 * understates net by `gross × rate²/(1+rate)` (#2637 review: caught by the
 * tax-inclusion-setting int-spec expecting 123 gross / 1.23 = 100, not
 * 123 × 0.77 = 94.71).
 */
export function deriveNetLineAmount(
  unitPrice: number,
  quantity: number,
  taxRate: string | null | undefined,
  taxTreatment: PriceTaxTreatment | null | undefined
): number | null {
  const lineTotal = unitPrice * quantity;
  if (taxTreatment === 'exclusive') {
    return lineTotal;
  }
  const rateOutcome = resolveNetSalesTaxRate(taxRate);
  if (rateOutcome.kind === 'unknown') {
    return null;
  }
  return lineTotal / (1 + rateOutcome.rateFraction);
}

/**
 * The SQL `CASE` expression implementing {@link resolveNetSalesTaxRate}'s
 * numeric/exempt-code rule, parameterized on a qualified column reference
 * (e.g. `li."taxRate"`) so every SQL call site shares one expression instead
 * of hand-retyping it. Evaluates to `NULL` for the `unknown` outcome — a
 * caller divides `<gross> / (1 + <this>)` (never multiplies by
 * `(1 - <this>)`, which understates net — see {@link netSalesLineNetAmountSql})
 * and must gate on `IS NOT NULL` separately (there is no SQL equivalent of
 * the tagged-union `kind` field).
 *
 * Both halves of this file change together: adding a member to
 * {@link NetSalesExemptTaxRateCodeValues} or changing the numeric bounds
 * above must update this expression in the same commit.
 */
export function netSalesRateFractionSql(taxRateColumnRef: string): string {
  const exemptList = NetSalesExemptTaxRateCodeValues.map((code) => `'${code}'`).join(',');
  return `CASE
      WHEN ${taxRateColumnRef} IN (${exemptList}) THEN 0
      WHEN ${taxRateColumnRef} ~ '^[0-9]+(\\.[0-9]+)?$'
           AND ${taxRateColumnRef}::numeric >= 0 AND ${taxRateColumnRef}::numeric <= 100
           AND NOT (${taxRateColumnRef}::numeric > 0 AND ${taxRateColumnRef}::numeric < 1)
      THEN (${taxRateColumnRef}::numeric / 100)
      ELSE NULL
    END`;
}

/**
 * SQL for one line's VAT-exclusive amount, honoring the parent order's
 * {@link PriceTaxTreatment}. Mirrors {@link deriveNetLineAmount} — divides
 * the gross line total by `(1 + rate)` rather than multiplying by
 * `(1 - rate)`, which understates net (#2637 review).
 */
export function netSalesLineNetAmountSql(
  unitPriceColumnRef: string,
  quantityColumnRef: string,
  taxRateColumnRef: string,
  taxTreatmentColumnRef: string
): string {
  const lineTotal = `${unitPriceColumnRef} * ${quantityColumnRef}`;
  const rateFraction = netSalesRateFractionSql(taxRateColumnRef);
  return `CASE
      WHEN ${taxTreatmentColumnRef} = 'exclusive' THEN ${lineTotal}
      ELSE ${lineTotal} / (1 + (${rateFraction}))
    END`;
}

/**
 * The ERA half of net-sales eligibility, split out so the two eligibility
 * predicates below cannot disagree about it (#2469, epic #2452 Phase 5).
 *
 * `false` (the default everywhere) keeps ADR-063's blanket exclusion: a
 * `taxRateEra = 'pre-rollout'` order never enters a net figure, whatever its
 * lines say.
 *
 * `true` is the operator's org-wide opt-in
 * (`analytics_display_settings.include_backfilled_tax_rates_in_net_sales`,
 * #2461, ADR-063's amendment for #2456) and it makes the era clause VACUOUS —
 * it does NOT drop the requirement that the rate resolve. That requirement is
 * already the sibling clauses of both predicates: an order still needs line
 * items and either net pricing or a resolvable rate on every line, and a line
 * still needs its own resolvable rate. So a pre-rollout order is admitted
 * exactly when `TaxRateBackfillService` (or ingestion) has actually written a
 * real rate for it — which IS Phase 4's category-A definition, reached through
 * the same `netSalesRateFractionSql` resolution rule the detector's
 * `resolveNetSalesTaxRate` uses, rather than a second copy of it.
 *
 * ONE HALF OF CATEGORY A IS DELIBERATELY NOT ADMITTED, and the difference
 * matters. `TaxCoverageDetectionService` also counts an order as category A
 * when a rate is merely RESOLVABLE from the live catalogue right now
 * (`IProductsService.getEffectiveTaxRate`) but has not been written to
 * `order_line_items.taxRate` yet. A live catalogue read has no SQL equivalent,
 * and net-sales arithmetic needs a stored rate to compute with — there is
 * nothing to multiply by. Turning the setting ON therefore does not by itself
 * pull such an order into Net Sales; running the backfill does, which is
 * exactly what `POST /analytics/coverage/tax/rerun-backfill` exists for.
 *
 * Never a bare `TRUE` at a call site: both predicates route through this
 * function so the flag has one meaning and one place to change.
 */
export function netSalesEraEligibleSql(includeBackfilledPreRollout: boolean): string {
  return includeBackfilledPreRollout ? 'TRUE' : `rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'`;
}

/**
 * Order-level net-sales eligibility predicate: era-eligible (see
 * {@link netSalesEraEligibleSql}), has line items, and either net-priced
 * (`exclusive`) or every line resolves a tax rate.
 *
 * `includeBackfilledPreRollout` is REQUIRED rather than defaulted: this
 * predicate decides whether a range of orders appears in a revenue figure, and
 * a caller that forgot to thread the operator's setting through would silently
 * report the pre-#2469 number while the UI said the setting was on.
 */
export function netSalesOrderNetEligibleSql(
  orderRecordIdColumnRef: string,
  lineItemTableAlias: string,
  taxTreatmentColumnRef: string,
  includeBackfilledPreRollout: boolean
): string {
  const rateFraction = netSalesRateFractionSql(`${lineItemTableAlias}."taxRate"`);
  return `(
      ${netSalesEraEligibleSql(includeBackfilledPreRollout)}
      AND EXISTS (
        SELECT 1 FROM order_line_items ${lineItemTableAlias}
        WHERE ${lineItemTableAlias}."orderRecordId" = ${orderRecordIdColumnRef}
      )
      AND (
        ${taxTreatmentColumnRef} = 'exclusive'
        OR NOT EXISTS (
          SELECT 1 FROM order_line_items ${lineItemTableAlias}
          WHERE ${lineItemTableAlias}."orderRecordId" = ${orderRecordIdColumnRef}
            AND (${rateFraction}) IS NULL
        )
      )
    )`;
}

/**
 * Line-level net-sales eligibility for stamped orders: era-eligible (see
 * {@link netSalesEraEligibleSql}) and either net-priced or the line's own tax
 * rate resolves.
 *
 * Note this is per LINE, so with the opt-in on, a pre-rollout order with one
 * resolvable line and one unresolvable line contributes its resolvable line to
 * the per-product net figures while the ORDER-level predicate above excludes
 * the order entirely. That asymmetry predates this change — it is the same
 * grain difference #1988's per-product read has always had against #1987's
 * order-level aggregates — and the flag is threaded identically into both so
 * it cannot introduce a third behaviour.
 */
export function netSalesLineNetEligibleConditionSql(
  taxRateColumnRef: string,
  taxTreatmentColumnRef: string,
  includeBackfilledPreRollout: boolean
): string {
  const rateFraction = netSalesRateFractionSql(taxRateColumnRef);
  return `(${netSalesEraEligibleSql(includeBackfilledPreRollout)} AND (${taxTreatmentColumnRef} = 'exclusive' OR (${rateFraction}) IS NOT NULL))`;
}
