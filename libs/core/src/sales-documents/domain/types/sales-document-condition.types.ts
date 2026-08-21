/**
 * Sales-Document Rule Condition Types (#2170, ADR-041 decision 5, narrowed)
 *
 * The closed, cross-country condition vocabulary a `sales_document_rules` row
 * matches an order against. Every field is deliberately neutral —
 * `buyerHasTaxId`, not `buyerHasNip`; `orderCountry`, not `krajOdbiorcy` — so a
 * German rule reads the SAME `buyerHasTaxId` field a Polish rule does, rendered
 * in each operator's locale at the presentation layer only. Nothing here may
 * ever be a country-specific literal (grep-verified by the acceptance criteria
 * of #2170 — no `"NIP"` / `"KSeF"` / `"VAT"` string anywhere under this
 * concern).
 *
 * `computeSalesDocumentConditionsHash` imports `node:crypto` — a Node builtin,
 * not a framework and not a sibling `@openlinker/core/<ctx>` barrel, so it does
 * not touch the zero-outbound-CORE-context-edge property this concern's other
 * files are pinned to (see the barrel-purity spec's scoping note).
 *
 * `orderTotalGross` is the one field that can never carry an inline literal
 * (ADR-041 decision 5's own text): it always references a `thresholdRef` into
 * `sales_document_thresholds`, so a legal amount versions independently of
 * every rule that cites it. `buyerHasTaxId` / `orderCountry` compare against an
 * inline `value` instead — there is no legal-matrix versioning concern for a
 * boolean or a country code.
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
 * `field` — each field carries exactly the comparison shape that field needs,
 * which is what keeps `orderTotalGross` structurally unable to carry an inline
 * literal amount.
 */
export type SalesDocumentCondition =
  | { readonly field: 'buyerHasTaxId'; readonly op: 'eq'; readonly value: boolean }
  | { readonly field: 'orderCountry'; readonly op: 'eq'; readonly value: string }
  | {
      readonly field: 'orderTotalGross';
      readonly op: SalesDocumentThresholdComparisonOp;
      readonly thresholdRef: string;
    };

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
      typeof value.thresholdRef === 'string' &&
      value.thresholdRef.length > 0
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
