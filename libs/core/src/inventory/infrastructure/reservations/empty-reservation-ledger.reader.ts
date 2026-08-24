/**
 * Empty Reservation Ledger Reader (#2321, ADR-061 decision 1)
 *
 * The Wave-1b implementation of {@link ReservationLedgerReaderPort}: there is no
 * reservation table yet, so there are no reservations, so every sum is zero.
 *
 * **This is the byte-identity guarantee, in code.** `computeAtp` subtracts a
 * ledger term that is always `0` here, so every quantity the computed seam
 * produces equals what the four shipped buffer sites publish today. Wave 2
 * replaces the `RESERVATION_LEDGER_READER_TOKEN` binding with a real
 * repository — this class is then **deleted, never extended**: growing it a
 * conditional would give the codebase two places that decide whether a
 * reservation counts.
 *
 * @module libs/core/src/inventory/infrastructure/reservations
 * @implements {ReservationLedgerReaderPort}
 */
import { Injectable } from '@nestjs/common';
import type {
  ReservationLedgerReaderPort,
  SumReservedInput,
} from '../../domain/ports/reservation-ledger-reader.port';

@Injectable()
export class EmptyReservationLedgerReader implements ReservationLedgerReaderPort {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature is the contract; Wave 2's reader uses every field.
  sumReservedByVariantIds(_input: SumReservedInput): Promise<ReadonlyMap<string, number>> {
    return Promise.resolve(new Map<string, number>());
  }
}
