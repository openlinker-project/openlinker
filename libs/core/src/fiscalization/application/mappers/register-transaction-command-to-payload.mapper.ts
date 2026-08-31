/**
 * Register Transaction Command to Job Payload Mapper (#2525)
 *
 * Flattens a `RegisterTransactionCommand` into the serializable
 * `fiscalization.register` job payload.
 *
 * It exists because there are now two callers that enqueue that job - the
 * auto-issue gate and the manual HTTP path - and a payload composed twice is a
 * payload that can be composed differently twice. The `occurredAt` `Date` to
 * ISO-8601 conversion in particular is the kind of detail one call site loses
 * silently, and the job would then register the sale at the wrong instant.
 *
 * Pure: no I/O, no injected dependency, and it reads only the command it is
 * given plus the provenance the caller passes alongside it.
 *
 * @module libs/core/src/fiscalization/application/mappers
 */
import type { FiscalizationRegisterPayloadV1 } from '@openlinker/core/sync';

import type { RegisterTransactionCommand } from '../../domain/types/fiscalization.types';

/**
 * Provenance the payload carries but the command does not: which connection the
 * ORDER came from, and the trace token of the event that led here.
 */
export interface FiscalizationRegisterPayloadProvenance {
  /** The order's source connection - never the fiscalization one. */
  sourceConnectionId: string;
  /** Only trace token at the seam; absent for an operator-initiated request. */
  sourceEventId?: string;
}

export function toFiscalizationRegisterPayload(
  command: RegisterTransactionCommand,
  provenance: FiscalizationRegisterPayloadProvenance,
): FiscalizationRegisterPayloadV1 {
  const payload: FiscalizationRegisterPayloadV1 = {
    schemaVersion: 1,
    connectionId: command.connectionId,
    orderId: command.orderId,
    idempotencyKey: command.idempotencyKey,
    currency: command.currency,
    lines: command.lines,
    totalGross: command.totalGross,
    sourceConnectionId: provenance.sourceConnectionId,
  };

  // SERIALIZATION CONTRACT: `occurredAt` is a `Date` on the command; the jsonb
  // payload carries it as ISO-8601 (see the payload type's own doc).
  if (command.occurredAt !== undefined) {
    payload.occurredAt = command.occurredAt.toISOString();
  }
  if (command.recipient !== undefined) {
    payload.recipient = command.recipient;
  }
  if (provenance.sourceEventId !== undefined) {
    payload.sourceEventId = provenance.sourceEventId;
  }
  // The era marker exempts pre-rollout history from the write-path tax-rate
  // guard (#2260 review). It has to survive the hop or the guard in
  // `FiscalRegistrationService` re-decides the question without it - accepting
  // the order here and refusing it there.
  if (command.taxRateEra !== undefined && command.taxRateEra !== null) {
    payload.taxRateEra = command.taxRateEra;
  }

  return payload;
}
