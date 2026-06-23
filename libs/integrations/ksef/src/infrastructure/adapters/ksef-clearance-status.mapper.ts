/**
 * KSeF Clearance Status Mapper (#1150 / C6)
 *
 * Pure, side-effect-free translation of a KSeF-native session/invoice status
 * code onto the neutral CTC `RegulatoryStatus` lifecycle (ADR-026). Kept as a
 * standalone function (with its own spec) so the full status table is unit-
 * tested in isolation from the adapter's HTTP plumbing.
 *
 * Semantics:
 *  - `100`/`150` (processing) → `submitted` (non-terminal; the caller polls again).
 *  - `200` (success) → `accepted` (the document cleared; KSeF assigned a number).
 *  - `210`/`410`/`445` (expired / gone / zero-valid) → `rejected` (terminal failure).
 *  - any other 4xx-family business code → `rejected` (terminal; unknown but non-retryable).
 *  - `5xx` → `null` sentinel: NOT mapped. The adapter treats `null` as "transient,
 *    let the reconciliation job (#1121) retry" and never reports a 5xx as a status.
 *
 * `cleared` vs `accepted`: KSeF performs validation + clearance in one act — there
 * is no distinct "cleared, pending acceptance" intermediate, so a `200` maps
 * straight to the terminal-success `accepted` (the neutral enum's strongest
 * positive state). `cleared` is reserved for regimes that split the two.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import type { RegulatoryStatus } from '@openlinker/core/invoicing';
import {
  KSEF_SESSION_CLOSED_ZERO_VALID,
  KSEF_STATUS_GONE,
  KSEF_STATUS_IN_PROGRESS,
  KSEF_STATUS_PROCESSING_STARTED,
  KSEF_STATUS_SESSION_EXPIRED,
  KSEF_STATUS_SUCCESS,
} from './ksef-session.types';

/**
 * Map a KSeF status code to a neutral `RegulatoryStatus`, or `null` when the
 * code is in the `5xx` transient band (the caller must retry, never report it).
 */
export function mapKsefStatusToRegulatoryStatus(code: number): RegulatoryStatus | null {
  if (code >= 500 && code < 600) {
    return null; // Transient — let the reconciliation job retry.
  }
  switch (code) {
    case KSEF_STATUS_PROCESSING_STARTED:
    case KSEF_STATUS_IN_PROGRESS:
      return 'submitted';
    case KSEF_STATUS_SUCCESS:
      return 'accepted';
    case KSEF_STATUS_SESSION_EXPIRED:
    case KSEF_STATUS_GONE:
    case KSEF_SESSION_CLOSED_ZERO_VALID:
      return 'rejected';
    default:
      // Any other deterministic business code is terminal and non-retryable.
      return 'rejected';
  }
}
