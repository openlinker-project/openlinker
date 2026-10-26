/**
 * Sales-Document Rule Condition Types (#2170, ADR-041 decision 5, narrowed)
 *
 * The closed, cross-country condition vocabulary a `sales_document_rules` row
 * matches an order against. Every field is deliberately neutral —
 * `buyerHasTaxId`, not a national tax-identifier name; `orderCountry`, not a
 * locale-specific field name — so a rule authored for one country reads the
 * SAME `buyerHasTaxId` field a rule authored for another country does,
 * rendered in each operator's locale at the presentation layer only. Nothing
 * here may ever be a country-specific literal — enforced by
 * `libs/core/src/sales-documents/__tests__/neutral-vocabulary.spec.ts`, a
 * build-failing sweep over this whole concern (the #3183 port of the
 * fiscalization litmus, ADR-042 decision 4 — same rule, a different matcher,
 * for the reason that spec's own header gives), not merely a documentation
 * promise the way the old "grep-verified" wording implied.
 *
 * A COST OF THAT CHOICE, recorded so it is visible to whoever revisits
 * ADR-041 decision 5: because the sweep covers prose too, this comment can
 * name only the neutral spelling and not the country-specific one it replaces,
 * so the side-by-side contrast that once made the rule teachable cannot be
 * written down here. The alternative — amend the ADR to carve doc comments
 * out, as ADR-026 does for `invoicing`, whose sibling guard shipping in the
 * same change demonstrates that narrower shape — was weighed and declined:
 * ADR-041 decision 5 states the ban over "this concern" without qualification,
 * and a guard looser than its own ADR is worse than a comment that has to
 * describe the banned half instead of showing it. Changing that means changing
 * the ADR and the sweep's scope together, never the sweep alone.
 *
 * `computeSalesDocumentConditionsHash` imports `node:crypto` — a Node builtin,
 * not a framework and not a sibling `@openlinker/core/<ctx>` barrel, so it does
 * not touch the zero-outbound-CORE-context-edge property this concern's other
 * files are pinned to (see the barrel-purity spec's scoping note).
 *
 * `orderTotalGross` carries an INLINE `amount` + `currency` (#3189, amending
 * ADR-041 decision 5, under which it referenced a `thresholdRef` into
 * `sales_document_thresholds` so a legal amount could version independently of
 * every rule citing it). That indirection made the amount UNAUTHORABLE: an
 * operator could only pick a seeded threshold, so "under 450 PLN **or** 100
 * EUR" — which Polish law names — was inexpressible, and a euro-priced order
 * delivered to Poland matched no rule at all. Independent versioning is the
 * price and it is paid knowingly: a legal amount that changes is now an edit to
 * each rule citing it rather than to one row.
 *
 * The amount is a DECIMAL STRING, never a number. Conditions live in jsonb,
 * where a JSON number is an IEEE-754 double and `450.10` does not round-trip as
 * itself; the automation condition types (#2358) carry money the same way for
 * the same reason. It is compared, never summed.
 *
 * A currency mismatch does not match, and is NEVER converted — the FX stamp
 * (ADR-040) is analytics-only and explicitly forbidden as a fiscal-document
 * rate source. A second currency is a second rule.
 *
 * `buyerHasTaxId` / `orderCountry` compare against an inline `value`.
 *
 * This is a dependency-free leaf file (no imports) — see the `sales-documents`
 * barrel doc comment and `libs/core/src/__tests__/barrel-purity.spec.ts` for why
 * that property matters for this whole concern.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
import { createHash } from 'node:crypto';

/** The closed, cross-country condition field vocabulary. */
export const SalesDocumentConditionFieldValues = [
  'buyerHasTaxId',
  'orderCountry',
  'orderTotalGross',
] as const;

export type SalesDocumentConditionField = (typeof SalesDocumentConditionFieldValues)[number];

/** Comparison operators a threshold-based condition may use (never inferred). */
export const SalesDocumentThresholdComparisonOpValues = ['gte', 'lt'] as const;
export type SalesDocumentThresholdComparisonOp =
  (typeof SalesDocumentThresholdComparisonOpValues)[number];

/**
 * One condition inside a rule's `conditions` array. A discriminated union on
 * `field` — each field carries exactly the comparison shape that field needs.
 * Since #3189 `orderTotalGross` carries its amount and currency INLINE; see the
 * module doc above for why that indirection was removed and what it cost.
 */
export type SalesDocumentCondition =
  | { readonly field: 'buyerHasTaxId'; readonly op: 'eq'; readonly value: boolean }
  | { readonly field: 'orderCountry'; readonly op: 'eq'; readonly value: string }
  | {
      readonly field: 'orderTotalGross';
      readonly op: SalesDocumentThresholdComparisonOp;
      /** Decimal string (e.g. `'450.00'`) - never a JSON number; see the module doc. */
      readonly amount: string;
      /** ISO 4217 alphabetic code, uppercase. Compared, never converted. */
      readonly currency: string;
    };

/**
 * A well-formed non-negative decimal amount: digits, optionally a single
 * decimal point followed by one or more digits. No sign, no exponent, no
 * separator, no whitespace.
 *
 * Deliberately strict. A malformed condition makes its whole rule read as
 * "never matches" — that is what `isSalesDocumentCondition` returning `false`
 * means to every caller — and the only thing worse than rejecting a value here
 * is ACCEPTING one the comparison then misreads: `parseFloat('450 PLN')` is
 * `450` and `Number('')` is `0`, either of which would route real orders on a
 * figure nobody typed.
 */
export function isDecimalAmountString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value);
}

/** An ISO 4217 alphabetic code as this concern stores it: exactly three A–Z. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

/**
 * Compare two well-formed decimal amount strings, `Array.prototype.sort`
 * convention (negative when `a < b`).
 *
 * Deliberately NOT via `parseFloat`: that is the step which reintroduces the
 * binary-float error the decimal string was chosen to avoid. Both sides are
 * already known well-formed, so it is an integer comparison once the fractional
 * parts are padded to a common width.
 *
 * **It does NOT decide which document a sale gets** (#3241 review, correcting
 * an earlier version of this comment that said so). `evaluateSalesDocumentRules`
 * compares with `Number(condition.amount)` against `order.totalGross`, which is
 * already a JS number - no comparison can be more exact than that operand, so
 * routing an order through BigInt would buy nothing. What this function serves
 * is comparison between two AUTHORED amounts, where both sides are decimal
 * strings and exactness is real: the overlap detector (#3190) intersects two
 * rules' bounds with it.
 */
export function compareDecimalAmountStrings(a: string, b: string): number {
  const [aInt, aFrac = ''] = a.split('.');
  const [bInt, bFrac = ''] = b.split('.');
  const width = Math.max(aFrac.length, bFrac.length);
  const left = BigInt(aInt + aFrac.padEnd(width, '0'));
  const right = BigInt(bInt + bFrac.padEnd(width, '0'));
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Narrow an untrusted value (a JSONB column read back from the repository) to
 * one well-formed `SalesDocumentCondition`. Returns `null` on any shape
 * mismatch — callers treat a malformed persisted condition as "never matches"
 * rather than throwing, since a bad row must not crash the whole resolve.
 */
export function isSalesDocumentCondition(value: unknown): value is SalesDocumentCondition {
  if (!isRecord(value)) return false;
  const { field, op } = value;
  if (field === 'buyerHasTaxId') {
    return op === 'eq' && typeof value.value === 'boolean';
  }
  if (field === 'orderCountry') {
    return op === 'eq' && typeof value.value === 'string' && value.value.length > 0;
  }
  if (field === 'orderTotalGross') {
    return (
      (SalesDocumentThresholdComparisonOpValues as readonly string[]).includes(op as string) &&
      isDecimalAmountString(value.amount) &&
      isCurrencyCode(value.currency)
    );
  }
  return false;
}

/**
 * Canonical, order-independent serialization of a conditions array — the
 * input to the conflict-guard's `conditionsHash`. Conditions are sorted by
 * field first (each field appears at most once per rule in practice, but
 * sorting is defensive rather than assumed), then serialized with sorted
 * object keys, so two conditions arrays describing the identical rule always
 * canonicalize to the same string regardless of authoring order.
 */
export function canonicalizeSalesDocumentConditions(
  conditions: readonly SalesDocumentCondition[],
): string {
  const sorted = [...conditions].sort((a, b) => a.field.localeCompare(b.field));
  return JSON.stringify(
    sorted.map((condition) => {
      const keys = Object.keys(condition).sort();
      const ordered: Record<string, unknown> = {};
      for (const key of keys) {
        ordered[key] = (condition as unknown as Record<string, unknown>)[key];
      }
      return ordered;
    }),
  );
}

/**
 * `sales_document_rules.conditionsHash` — the conflict guard's join key. A
 * plain SHA-256 hex digest of {@link canonicalizeSalesDocumentConditions};
 * deterministic, and computed in application code rather than a DB generated
 * column (this concern ships no database-level guard beyond a plain unique
 * index — see the write-path service for why the semantic overlap check
 * cannot be a trigger).
 */
export function computeSalesDocumentConditionsHash(
  conditions: readonly SalesDocumentCondition[],
): string {
  return createHash('sha256').update(canonicalizeSalesDocumentConditions(conditions)).digest('hex');
}
