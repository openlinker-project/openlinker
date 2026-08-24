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
  const parsed = Number.parseFloat(trimmed);
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
  return lineTotal * (1 - rateOutcome.rateFraction);
}

/**
 * The SQL `CASE` expression implementing {@link resolveNetSalesTaxRate}'s
 * numeric/exempt-code rule, parameterized on a qualified column reference
 * (e.g. `li."taxRate"`) so every SQL call site shares one expression instead
 * of hand-retyping it. Evaluates to `NULL` for the `unknown` outcome — a
 * caller sums `<gross> * (1 - <this>)` and must gate on `IS NOT NULL`
 * separately (there is no SQL equivalent of the tagged-union `kind` field).
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
 * {@link PriceTaxTreatment}. Mirrors {@link deriveNetLineAmount}.
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
      ELSE ${lineTotal} * (1 - (${rateFraction}))
    END`;
}

/**
 * Order-level net-sales eligibility predicate: post-rollout, has line items,
 * and either net-priced (`exclusive`) or every line resolves a tax rate.
 */
export function netSalesOrderNetEligibleSql(
  orderRecordIdColumnRef: string,
  lineItemTableAlias: string,
  taxTreatmentColumnRef: string
): string {
  const rateFraction = netSalesRateFractionSql(`${lineItemTableAlias}."taxRate"`);
  return `(
      rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'
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
 * Line-level net-sales eligibility for stamped orders: post-rollout and
 * either net-priced or the line's own tax rate resolves.
 */
export function netSalesLineNetEligibleConditionSql(
  taxRateColumnRef: string,
  taxTreatmentColumnRef: string
): string {
  const rateFraction = netSalesRateFractionSql(taxRateColumnRef);
  return `(rec."taxRateEra" IS DISTINCT FROM 'pre-rollout' AND (${taxTreatmentColumnRef} = 'exclusive' OR (${rateFraction}) IS NOT NULL))`;
}
