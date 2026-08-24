/**
 * Inventory testing sub-barrel (#2323)
 *
 * Test-only exports, kept off the main `@openlinker/core/inventory` barrel so
 * nothing in a runtime path can reach them (the `<ctx>/testing` convention —
 * see `docs/engineering-standards.md § Import Aliases`).
 *
 * It publishes the availability parity fixture #2321 exported for exactly this
 * purpose: the matrix that pins the computed seam's arithmetic to the
 * arithmetic the shipped publish sites perform. It lives here rather than being
 * restated because a matrix restated in two places is a matrix that drifts —
 * the `apps/api` byte-identity integration test and the core unit specs assert
 * against the *same* cells, which is the whole reason the rewire is safe.
 *
 * @module libs/core/src/inventory/testing
 */
export {
  AVAILABILITY_PARITY_CASES,
  toConnectionConfig,
  toVariantAvailabilityRow,
} from '../application/services/__tests__/availability-parity.fixture';
export type { AvailabilityParityCase } from '../application/services/__tests__/availability-parity.fixture';
