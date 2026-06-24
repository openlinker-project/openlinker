/**
 * KSeF Clearance Status Mapper (#1150 / C6)
 *
 * Pure, side-effect-free translation of a KSeF-native session/invoice status
 * code onto the neutral CTC `RegulatoryStatus` lifecycle (ADR-026). Kept as a
 * standalone function (with its own spec) so the full status table is unit-
 * tested in isolation from the adapter's HTTP plumbing.
 *
 * Code ranges (confirmed from the official CIRFMF C# client/tests):
 *  - `100 <= code < 200` (processing started / in progress) → `submitted`
 *    (non-terminal; the caller polls again).
 *  - `code === 200` (Success) → `accepted` (the document cleared; KSeF assigned
 *    a number).
 *  - `500 <= code < 600` → `null` sentinel: NOT mapped. The adapter treats `null`
 *    as "transient, let the reconciliation job (#1121) retry" and never reports
 *    a 5xx as a status.
 *  - any other code (e.g. `400`) → `rejected` (terminal; deterministic business
 *    failure, non-retryable).
 *
 * `cleared` vs `accepted`: KSeF performs validation + clearance in one act — there
 * is no distinct "cleared, pending acceptance" intermediate, so a `200` maps
 * straight to the terminal-success `accepted` (the neutral enum's strongest
 * positive state). `cleared` is reserved for regimes that split the two.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import type { RegulatoryStatus } from '@openlinker/core/invoicing';
import { KSEF_STATUS_SUCCESS } from './ksef-session.types';

/**
 * Map a KSeF status code to a neutral `RegulatoryStatus`, or `null` when the
 * code is in the `5xx` transient band (the caller must retry, never report it).
 */
export function mapKsefStatusToRegulatoryStatus(code: number): RegulatoryStatus | null {
  if (code >= 500 && code < 600) {
    return null; // Transient — let the reconciliation job retry.
  }
  if (code >= 100 && code < KSEF_STATUS_SUCCESS) {
    return 'submitted'; // Processing started / in progress — keep polling.
  }
  if (code === KSEF_STATUS_SUCCESS) {
    return 'accepted'; // Cleared; KSeF assigned a number.
  }
  // Any other deterministic business code is terminal and non-retryable.
  return 'rejected';
}
