/**
 * Availability Service Interface (#2321, ADR-061)
 *
 * The single seam that answers *"how many units may we promise for this
 * variant, in this scope, and how do we know?"*.
 *
 * Today it has exactly one implementation and, deliberately, **no production
 * caller** — every rewire of the four shipped publish sites is #2323. That is
 * the `fulfillment-authority` posture (#2304): the vocabulary and the seam ship
 * first so the contexts that adopt them adopt one spelling, and the rewire is a
 * reviewable change against a computed answer that is already proven identical.
 *
 * Wave 3 (ADR-061 decision 2) adds the dispatched `AvailabilityAuthority`
 * fallback **behind this same signature** — an authority-answered scope simply
 * returns `provenance: 'authority'` — so a #2323 caller written against this
 * interface needs no further change when it lands.
 *
 * @module libs/core/src/inventory/application/services
 * @see {@link AvailabilityService} for the implementation
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import type {
  AvailabilityProvenance,
  AvailabilityScope,
  PromisableQuantity,
} from '../../domain/types/availability.types';

export interface GetPromisableQuantitiesInput {
  readonly variantIds: readonly string[];
  readonly scope: AvailabilityScope;
  /**
   * Clock for `stalenessMs`. Injected rather than read internally so a caller
   * timing a batch stamps one instant across it, and so tests are deterministic.
   */
  readonly now?: Date;
}

/**
 * A caller-supplied quantity plus the scope whose Controls apply to it (#2323).
 */
export interface ApplyPublishControlsInput {
  /**
   * The quantity the caller intends to publish, BEFORE Controls.
   *
   * Deliberately caller-supplied rather than read from the seam: on the
   * single-variant / passthrough publish paths this is the *operator's* stated
   * intent, not master availability, and substituting available-to-promise
   * would change every published number on those paths. The three quantity-only
   * sites (`InventorySyncService` and the two publish builders) also hold no
   * variant id to ask about — threading one is #2324's declared work.
   */
  readonly quantity: number;
  readonly scope: AvailabilityScope;
}

/**
 * The post-Control quantity, with the provenance of the Control resolution.
 *
 * `quantity` is `null` if and only if `provenance` is `'unknown'`, mirroring
 * {@link PromisableQuantity} — there is no representation of "we could not
 * resolve the Controls but here is a number anyway".
 */
export interface PublishControlResult {
  readonly quantity: number | null;
  readonly provenance: AvailabilityProvenance;
}

/**
 * Several quantities that share ONE scope, so the Controls are resolved once.
 *
 * Additive to {@link ApplyPublishControlsInput} rather than replacing it: the
 * three single-quantity publish sites hold exactly one number and gain nothing
 * from a list.
 */
export interface ApplyPublishControlsBatchInput {
  readonly quantities: readonly number[];
  readonly scope: AvailabilityScope;
}

/** One entry of {@link IAvailabilityService.applyPublishControlsBatch}'s answer. */
export type ControlledQuantity = PublishControlResult;

export interface IAvailabilityService {
  /**
   * Available-to-promise for each requested variant, in input order.
   *
   * Output is **zero-filled and order-preserving**: one entry per requested id,
   * including variants with no inventory rows (`quantity: 0`,
   * `provenance: 'computed'`, `observedAt: null` — a known zero, not an
   * unknown). Empty input returns `[]` without touching the repository.
   *
   * Provenance is `'unknown'` **batch-wide** when the reservation-ledger read
   * throws; the failure is never swallowed to `0`, which would silently
   * oversell by the exact size of the outstanding holds.
   *
   * @throws {UnsupportedAvailabilityScopeError} for `location` / `order` /
   *   `work` scopes, which have no partitioned read yet.
   */
  getPromisableQuantities(
    input: GetPromisableQuantitiesInput
  ): Promise<readonly PromisableQuantity[]>;

  /**
   * Apply this scope's publish Controls to a caller-supplied quantity (#2323).
   *
   * This is the ONLY way a publish site obtains a post-buffer quantity: the
   * `stockSafetyBuffer` helpers (#1844) are read here and nowhere else, so the
   * "present but invalid" warning is emitted once, from one place, instead of
   * from four near-identical private copies.
   *
   * The arithmetic is byte-identical to what the four shipped sites performed
   * before the rewire — `applyStockSafetyBuffer(max(0, quantity), buffer)` — so
   * a published number is unchanged on every install. What is new is the
   * `provenance` arm: a Control resolution that fails (the connection read
   * throws) yields `{ quantity: null, provenance: 'unknown' }`, and a caller
   * MUST suppress its write rather than publish the unbuffered quantity.
   *
   * @throws {UnsupportedAvailabilityScopeError} for `location` / `order` /
   *   `work` scopes — a caller bug, not an outage (see the exception).
   */
  applyPublishControls(input: ApplyPublishControlsInput): Promise<PublishControlResult>;

  /**
   * {@link applyPublishControls} for a batch that shares one scope, in input
   * order — the Controls are resolved ONCE and the arithmetic mapped.
   *
   * This exists because a batch write path calling the single-quantity method
   * per item issues one connection read per ITEM for a value that cannot vary
   * within the batch; the pre-#2323 code did one read per batch, and
   * `InventorySyncService.updateOfferQuantities` is the hottest write path in
   * the system. It is NOT a caller-side optimisation to be replicated by
   * reading `getAppliedReserve` and applying the arithmetic yourself — that
   * method is display-only for exactly that reason.
   *
   * A Control resolution that fails degrades the WHOLE batch to
   * `{ quantity: null, provenance: 'unknown' }` per entry, mirroring
   * `getPromisableQuantities`'s batch-wide rule: a partial answer would let a
   * caller publish some unbuffered quantities and suppress others.
   *
   * @throws {UnsupportedAvailabilityScopeError} for `location` / `order` /
   *   `work` scopes — a caller bug, not an outage.
   */
  applyPublishControlsBatch(
    input: ApplyPublishControlsBatchInput
  ): Promise<readonly ControlledQuantity[]>;

  /**
   * The reserve this scope's Controls would hold back, for DISPLAY only.
   *
   * **Never use this to compute a quantity.** Applying it yourself re-scatters
   * the arithmetic `applyPublishControls` exists to own, and the two would drift
   * the first time a Control other than the buffer is added. It exists so an
   * operator-facing surface can render "and this is the cushion that produced
   * that number" without reaching for `readStockSafetyBuffer` directly — which
   * the #2323 grep-assert forbids everywhere outside this service.
   *
   * A `global` scope holds back nothing and answers `0`. A Control resolution
   * that throws propagates: a display read has no honest degraded value, and a
   * silent `0` would tell the operator no cushion is configured.
   */
  getAppliedReserve(scope: AvailabilityScope): Promise<number>;
}
