/**
 * Regulatory Status Read Types
 *
 * Neutral observation contract for `RegulatoryStatusReader.readRegulatoryStatus`.
 * An invoicing adapter reports the authoritative provider-/CTC-side regulatory
 * state of a previously-issued document (KSeF/SDI/SII). The adapter performs the
 * regime→neutral mapping; OL writes the neutral observation verbatim (subject to
 * the reconciliation service's write-on-change / monotonicity rules). Mirrors
 * `OfferStatusReadResult` (#816 / ADR-009).
 *
 * READ-ONLY: this sub-capability never transmits to the authority (Subiekt does
 * that natively); it only reads status back for reconciliation.
 *
 * @module libs/core/src/invoicing/domain/types
 * @see {@link RegulatoryStatusReader} for the capability
 */
import type { RegulatoryStatus } from './invoicing.types';

export interface RegulatoryStatusReadResult {
  /** Neutral CTC clearance status; adapter maps the regime's native state. */
  regulatoryStatus: RegulatoryStatus;
  /** Authority-assigned reference (KSeF number, SDI id, …); `null` when none yet. */
  clearanceReference: string | null;
}
