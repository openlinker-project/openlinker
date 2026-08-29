/**
 * Availability Types (#2321, ADR-061)
 *
 * The neutral vocabulary of an **available-to-promise** answer: how many units
 * OpenLinker is willing to promise for a scope, and — decisively — *where that
 * number came from*.
 *
 * Provenance is not decoration. ADR-061 decision (2) makes the publish write
 * conditional on it: a `'computed'` or `'authority'` answer is a number, while
 * `'unknown'` means OpenLinker does not know and the caller must **suppress the
 * publish and alert** rather than write a plausible-looking quantity. Every
 * consumer therefore writes a three-arm switch once, at the seam, instead of
 * treating an absent number as zero — which is the shape that oversells.
 *
 * Pure types plus the pure rules that derive them, per the `*.types.ts`
 * pure-rule exception in `docs/engineering-standards.md` (the
 * `pricing-rule.types.ts` / `stock-safety-buffer.types.ts` precedent): the
 * formula and the union change together, and splitting them invites a consumer
 * to restate the arithmetic.
 *
 * @module libs/core/src/inventory/domain/types
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import type { AuthorityScope } from '@openlinker/core/fulfillment-authority';
import { applyStockSafetyBuffer } from '@openlinker/core/identifier-mapping';

/**
 * The scope an availability question is asked about.
 *
 * A **type-only alias** of the `fulfillment-authority` leaf's `AuthorityScope`,
 * declared INVENTORY-SIDE on purpose: the leaf holds a zero-sibling-edge
 * property (`libs/core/src/__tests__/barrel-purity.spec.ts`), so it must not
 * learn that an inventory-flavoured spelling of its own type exists. The edge
 * points inventory → leaf, which is the direction ADR-052's A1 row already
 * assigns (`availability` is owned by `inventory`).
 *
 * It is a **discriminated union**, not a bag of optional ids — the `channel`
 * arm carries a REQUIRED `connectionId` — so callers narrow on `scope.kind` and
 * a scope this seam cannot answer for is a compile-time-visible arm rather than
 * a silently-ignored filter.
 */
export type AvailabilityScope = AuthorityScope;

/**
 * Where a promisable quantity came from.
 *
 * - `'computed'` — OpenLinker derived it from its own mirrored positions minus
 *   its own advisory reservations. The only value produced in Wave 1b.
 * - `'authority'` — a dispatched `AvailabilityAuthority` adapter answered
 *   (ADR-061 decision 2). **Declared and never produced here**: the capability
 *   is Wave 3. It ships in the union now so every consumer writes its switch
 *   once and the arm's later arrival is not a breaking change.
 * - `'unknown'` — OpenLinker does not know. Callers MUST suppress the publish
 *   write and alert; treating it as `0` undersells, treating it as the last
 *   known value oversells. Bounded in Wave 3 by
 *   `OL_AVAILABILITY_UNKNOWN_MAX_HOLD_MS`, which does not exist yet.
 */
export const AvailabilityProvenanceValues = ['authority', 'computed', 'unknown'] as const;

export type AvailabilityProvenance = (typeof AvailabilityProvenanceValues)[number];

/**
 * One variant's available-to-promise answer.
 *
 * `quantity` is `null` if and only if `provenance` is `'unknown'` — that pairing
 * is the whole point of the shape: there is no representation of "we do not know
 * but here is a number anyway".
 */
export interface PromisableQuantity {
  readonly productVariantId: string;
  /** Units OpenLinker will promise. `null` ⇔ `provenance === 'unknown'`. */
  readonly quantity: number | null;
  readonly provenance: AvailabilityProvenance;
  /**
   * When the underlying stock facts were last written (`MAX(updatedAt)` across
   * the variant's live positions), or `null` when the variant has no positions
   * at all — which is a legitimate, *known* answer of zero, not an absence of
   * knowledge. See {@link toPromisableQuantity}.
   */
  readonly observedAt: Date | null;
  /**
   * Age of `observedAt` against the caller's clock, in milliseconds, or `null`
   * when `observedAt` is `null`. Precomputed so a consumer rendering staleness
   * does not re-read a clock the seam already read (and disagree with it).
   */
  readonly stalenessMs: number | null;
  /**
   * Units OpenLinker holds in its own advisory ledger that are **not** reflected
   * in `quantity` (#2345, design §4.2) — the scoped-subtraction rule's
   * diagnostic half.
   *
   * `null` on the computed path, and that is not the same as `0`: OL computed
   * the number itself, so the holds ARE inside `quantity` and there is nothing
   * unreflected to report. `0` would say "no outstanding holds", which is a
   * different and usually false claim.
   *
   * A number only on the `'authority'` path, where the answer is taken as-is
   * and OL's own holds were deliberately not subtracted. `0` there is
   * meaningful: OL holds nothing the authority does not already know about.
   * `'unknown'` reports `null` — an answer that knows nothing knows nothing
   * about outstanding holds either.
   */
  readonly olHeldNotReflected: number | null;
}

/**
 * The computed-path formula, in one place (ADR-061 decision 2).
 *
 * `ATP = max(0, Σ available[live, all locations AND sources] − Σ olReserved[atpEffect='published'] − buffer)`
 *
 * Three properties are load-bearing.
 *
 * **Summing across sources is correct**, not a bug (ADR-058 decision 2): two
 * positions for the same variant that differ only in owning connection are
 * legitimate coexisting mirrors. Deduplicating them is #2319/#2325's problem,
 * deliberately not this seam's — doing it here would silently change published
 * quantities on a healthy multi-source install.
 *
 * **`inventory_items.reservedQuantity` is NEVER subtracted.** That column is a
 * mirror of the *master's own* reservation bookkeeping; subtracting it would
 * double-count against the master's already-decremented `availableQuantity` and
 * break byte-identity with every shipped publish path on day one. Only OL's own
 * advisory ledger rows stamped `atpEffect: 'published'` reduce ATP.
 *
 * **The buffer is applied last, as a Control** (ADR-061 decision 3) — it is an
 * operator's cushion on top of a computed promise, not part of the promise.
 */
export function computeAtp(
  totalAvailable: number,
  olReservedPublished: number,
  buffer: number
): number {
  return applyStockSafetyBuffer(Math.max(0, totalAvailable - olReservedPublished), buffer);
}

/**
 * Who answered the available-to-promise question for this scope.
 *
 * A deliberate NARROWING of {@link AvailabilityProvenance} that excludes
 * `'unknown'`: these are the two arms that carry a number, so a caller cannot
 * assemble an `'unknown'` answer through the same door as a real quantity (the
 * `quantity === null <=> provenance === 'unknown'` pairing stays structural).
 */
export type AtpAnsweredBy = Exclude<AvailabilityProvenance, 'unknown'>;

/**
 * The two shapes an ATP answer can arrive in, before Controls.
 *
 * A discriminated union rather than two optional fields, so "computed from our
 * own positions" and "an authority told us" can never be supplied together or
 * omitted together.
 */
export type AtpAnswer =
  | { readonly answeredBy: 'computed'; readonly totalAvailable: number }
  | { readonly answeredBy: 'authority'; readonly availableToPromise: number };

/** {@link applyScopedLedgerSubtraction}'s result: the number, and what it omits. */
export interface ScopedAtpResult {
  readonly quantity: number;
  readonly olHeldNotReflected: number | null;
}

/**
 * The scoped-subtraction rule (#2345, design §4.2).
 *
 * **OpenLinker subtracts its own ledger only for scopes where OpenLinker
 * computes ATP itself.** An authority-answered scope is taken as-is — OL's
 * holds are reported alongside as `olHeldNotReflected` and subtracted from
 * nothing. Subtracting there would double-count: an authority that models holds
 * has already netted its own, and one that does not is telling us a number OL
 * has no standing to reduce.
 *
 * Two properties are load-bearing rather than incidental.
 *
 * **The buffer applies on BOTH arms.** ADR-061 decision 3 makes it a Control —
 * the operator's own cushion on top of whatever produced the promise, not part
 * of the promise. Reconciling it against a future
 * `AvailabilityAnswer.controlsApplied` (an authority that already applied its
 * own) is Wave 3's, and is named here rather than guessed at now.
 *
 * **The authority arm is declared and never produced in Wave 2.** No dispatched
 * `AvailabilityAuthority` adapter exists, so `AvailabilityService` always passes
 * `'computed'`. It ships here anyway because the rule is what the issue is
 * about, and because a rule with one arm is a rule nobody can check — the arm is
 * asserted directly at this level, which is where it lives.
 */
export function applyScopedLedgerSubtraction(
  answer: AtpAnswer,
  olReservedPublished: number,
  buffer: number
): ScopedAtpResult {
  if (answer.answeredBy === 'authority') {
    return {
      quantity: applyStockSafetyBuffer(Math.max(0, answer.availableToPromise), buffer),
      olHeldNotReflected: olReservedPublished,
    };
  }

  return {
    quantity: computeAtp(answer.totalAvailable, olReservedPublished, buffer),
    olHeldNotReflected: null,
  };
}

/**
 * Assemble one `PromisableQuantity` from computed inputs.
 *
 * **A variant with zero inventory rows is `'computed'` with quantity `0` and
 * `observedAt: null` — never `'unknown'`.** Making it `'unknown'` would look
 * conservative and be wrong: the shipped contracts publish `0` for such a
 * variant today (#1844's master-is-authoritative-including-zero rule, and
 * #1689's stale-variant pause, which zeroes offers precisely so they stop
 * selling). Routing that case to `'unknown'` would make a publish that must
 * happen get suppressed, so a deleted product would keep selling — the exact
 * failure #1689 exists to close. `null` observedAt says "no facts were
 * observed"; the `0` says "and that is a known answer".
 */
export function toPromisableQuantity(input: {
  productVariantId: string;
  /**
   * Which arm produced `atp`. **Required, never defaulted** — the same reason
   * `SumReservedInput.atpEffect` is: a default here is a policy decision hidden
   * in a signature, and it is the field that tells a consumer whether the
   * ledger was subtracted.
   */
  provenance: AtpAnsweredBy;
  atp: ScopedAtpResult;
  observedAt: Date | null;
  now: Date;
}): PromisableQuantity {
  return {
    productVariantId: input.productVariantId,
    quantity: input.atp.quantity,
    provenance: input.provenance,
    observedAt: input.observedAt,
    stalenessMs:
      input.observedAt === null ? null : input.now.getTime() - input.observedAt.getTime(),
    olHeldNotReflected: input.atp.olHeldNotReflected,
  };
}

/**
 * The `'unknown'` answer for one variant (ADR-061 decision 2).
 *
 * Produced BATCH-WIDE when the reservation-ledger read throws: a partial answer
 * would mean some variants in one publish batch were computed against a ledger
 * term and others against nothing, and the caller has no way to tell which.
 */
export function unknownPromisableQuantity(productVariantId: string): PromisableQuantity {
  return {
    productVariantId,
    quantity: null,
    provenance: 'unknown',
    observedAt: null,
    stalenessMs: null,
    olHeldNotReflected: null,
  };
}
