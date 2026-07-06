/**
 * KSeF Clearance Status Mapper (#1150 / C6)
 *
 * Pure translation of a KSeF-native session/invoice processing-status code onto
 * the neutral CTC `RegulatoryStatus` lifecycle (ADR-026). Kept as a standalone
 * function (with its own spec) so the full status table is unit-tested in
 * isolation from the adapter's HTTP plumbing.
 *
 * The codes in a KSeF status BODY are processing codes — NOT HTTP status codes —
 * so HTTP-range banding does not apply. Each known code is mapped explicitly:
 *
 *  - `100` request accepted for processing, `150` in progress → `submitted`
 *    (non-terminal; the caller polls again). `100`/`200` are confirmed from the
 *    KSeF v2 OpenAPI; `150`/`440`/`445`/`550` from the CIRFMF status catalogue.
 *  - `200` Success → `accepted` (the document cleared; KSeF assigned a number).
 *  - `400` / `440` / `445` / `450` (validation / business rejection / session
 *    closed with zero valid invoices / document semantic-validation failure)
 *    → `rejected` (terminal; non-retryable).
 *  - `550` processing error → `null` sentinel: NOT mapped. The adapter treats
 *    `null` as "transient, let the reconciliation job (#1121) retry" and never
 *    reports it as a status.
 *
 * Unknown / unrecognised codes are deliberately NOT terminal: rejecting on an
 * unknown code is irreversible and would drop a still-clearing invoice. They
 * default to the non-terminal `submitted` (keep polling) and emit a warning so
 * the catalogue can be extended. `410` ("gone"/retention expiry) is a retention
 * artefact, not a business rejection — it falls through to the keep-polling
 * default rather than `rejected`.
 *
 * `cleared` vs `accepted`: KSeF performs validation + clearance in one act — there
 * is no distinct "cleared, pending acceptance" intermediate, so a `200` maps
 * straight to the terminal-success `accepted` (the neutral enum's strongest
 * positive state). `cleared` is reserved for regimes that split the two.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import { Logger } from '@openlinker/shared/logging';
import type { RegulatoryStatus } from '@openlinker/core/invoicing';
import {
  KSEF_STATUS_PROCESSING_STARTED,
  KSEF_STATUS_IN_PROGRESS,
  KSEF_STATUS_SUCCESS,
  KSEF_STATUS_REJECTED,
  KSEF_STATUS_FA3_PROCESSING,
  KSEF_STATUS_BUSINESS_REJECTED,
  KSEF_SESSION_CLOSED_ZERO_VALID,
  KSEF_STATUS_SEMANTIC_REJECTED,
  KSEF_STATUS_PROCESSING_ERROR,
} from './ksef-session.types';

const logger = new Logger('KsefClearanceStatusMapper');

/** Known non-terminal processing codes → `submitted` (keep polling). */
const SUBMITTED_CODES: ReadonlySet<number> = new Set([
  KSEF_STATUS_PROCESSING_STARTED,
  KSEF_STATUS_IN_PROGRESS,
  KSEF_STATUS_FA3_PROCESSING,
]);

/** Known terminal business-rejection codes → `rejected` (non-retryable). */
const REJECTED_CODES: ReadonlySet<number> = new Set([
  KSEF_STATUS_REJECTED,
  KSEF_STATUS_BUSINESS_REJECTED,
  KSEF_SESSION_CLOSED_ZERO_VALID,
  KSEF_STATUS_SEMANTIC_REJECTED,
]);

/**
 * Map a KSeF processing-status code to a neutral `RegulatoryStatus`, or `null`
 * when the code is the transient processing-error sentinel (the caller must
 * retry, never report it). Unknown codes default to `submitted` (keep polling).
 */
export function mapKsefStatusToRegulatoryStatus(code: number): RegulatoryStatus | null {
  if (code === KSEF_STATUS_SUCCESS) {
    return 'accepted'; // Cleared; KSeF assigned a number.
  }
  if (SUBMITTED_CODES.has(code)) {
    return 'submitted'; // Processing started / in progress — keep polling.
  }
  if (REJECTED_CODES.has(code)) {
    return 'rejected'; // Terminal business rejection — non-retryable.
  }
  if (code === KSEF_STATUS_PROCESSING_ERROR) {
    return null; // Transient — let the reconciliation job retry.
  }
  // Unknown code: never auto-reject (irreversible). Keep polling and flag it so
  // the catalogue can be extended.
  logger.warn(`Unknown KSeF status code ${code}; treating as non-terminal (submitted)`);
  return 'submitted';
}
