/**
 * Primary Invoicing Connection Types (#2047)
 *
 * One sale is one invoice, so at most ONE connection may auto-issue it. When an
 * operator runs several `Invoicing` connections (KSeF / inFakt / Subiekt are
 * alternative routes for the same document, not complementary steps), the one
 * that auto-issues must be an explicit operator choice, never incidental
 * ordering. That choice is persisted on `Connection.config.invoicing.isPrimary`
 * (jsonb — no migration), read here through the same untrusted-value coercion
 * precedent as `parseTriggerModel`.
 *
 * @module libs/core/src/invoicing/domain/types
 */

/**
 * Parse an untrusted `config.invoicing.isPrimary` value into a boolean. Only a
 * real `true` (or the string `'true'`, which is how a JSON config hand-edited
 * through a text field arrives) marks a connection primary; anything unset,
 * missing or unrecognized is `false`. Defaulting to `false` is what makes the
 * ambiguous multi-connection case issue NOTHING rather than issue twice.
 */
export function parseIsPrimaryInvoicing(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Outcome of resolving WHICH invoicing connection may auto-issue for an order.
 *
 * - `selected`   — exactly one connection is eligible; `connectionId` names it.
 * - `none`       — no active connection has `Invoicing` enabled: nothing to do.
 * - `ambiguous`  — several are eligible and the primary does not single one out
 *   (no primary set, or more than one). Deliberately issues NOTHING: an
 *   unissued invoice is recoverable by hand, two issued invoices for one sale
 *   are not.
 */
export type InvoicingConnectionSelection =
  | { kind: 'selected'; connectionId: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; reason: 'no-primary' | 'multiple-primaries'; candidateIds: string[] };

/**
 * One eligible invoicing connection, reduced to what the choice depends on.
 * Structural on purpose: the selection rule is a pure function that needs no
 * `Connection` entity (and therefore no cross-context import in this domain
 * types file) — the caller has already filtered to active + `Invoicing`-enabled
 * connections and coerced the primary flag.
 */
export interface InvoicingConnectionCandidate {
  readonly id: string;
  readonly isPrimary: boolean;
}

/**
 * Pick the single connection allowed to auto-issue, from the already-filtered
 * eligible candidates. Pure, no I/O.
 *
 * - 0 candidates          -> `none`.
 * - exactly 1 candidate   -> that one, primary flag IRRELEVANT. This is what
 *   keeps a single-connection install byte-identical to pre-#2047 behaviour: an
 *   operator who never heard of `isPrimary` must not silently stop invoicing.
 * - several candidates    -> the one primary, or `ambiguous` when none or more
 *   than one is primary. Ambiguity issues nothing on purpose (see the type doc).
 */
export function selectPrimaryInvoicingConnection(
  candidates: readonly InvoicingConnectionCandidate[],
): InvoicingConnectionSelection {
  if (candidates.length === 0) {
    return { kind: 'none' };
  }
  if (candidates.length === 1) {
    return { kind: 'selected', connectionId: candidates[0].id };
  }

  const primaries = candidates.filter((candidate) => candidate.isPrimary);
  if (primaries.length === 1) {
    return { kind: 'selected', connectionId: primaries[0].id };
  }
  return {
    kind: 'ambiguous',
    reason: primaries.length === 0 ? 'no-primary' : 'multiple-primaries',
    candidateIds: (primaries.length === 0 ? candidates : primaries).map(
      (candidate) => candidate.id,
    ),
  };
}
