/**
 * Empty Reservation Ledger Reader (#2321, ADR-061 decision 1)
 *
 * A zero ledger: every sum is empty, whatever it is asked.
 *
 * **This is the byte-identity guarantee, in code.** `computeAtp` subtracts a
 * ledger term that is always `0` here, so every quantity the computed seam
 * produces equals what the four shipped buffer sites published before #2321.
 *
 * #2345 swapped the `RESERVATION_LEDGER_READER_TOKEN` binding to the real
 * `ReservationLedgerReader`, so this class is **no longer reachable from any
 * production path** — its own Wave-1b docblock required exactly that. It moved
 * here rather than being deleted because the parity matrix genuinely needs a
 * zero ledger, and twenty inline stubs is how a fixture drifts. Do not bind it
 * in a module, and do not grow it a conditional: that would give the codebase
 * two places that decide whether a reservation counts.
 *
 * @module libs/core/src/inventory/testing
 * @implements {ReservationLedgerReaderPort}
 */
import type {
  ReservationLedgerReaderPort,
  SumReservedInput,
} from '../domain/ports/reservation-ledger-reader.port';

export class EmptyReservationLedgerReader implements ReservationLedgerReaderPort {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature is the contract; Wave 2's reader uses every field.
  sumReservedByVariantIds(_input: SumReservedInput): Promise<ReadonlyMap<string, number>> {
    return Promise.resolve(new Map<string, number>());
  }
}
