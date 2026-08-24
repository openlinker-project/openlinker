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
}
