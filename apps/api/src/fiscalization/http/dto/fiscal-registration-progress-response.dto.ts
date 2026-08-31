/**
 * Fiscal Registration Progress Response DTO (#2526)
 *
 * The poll target for a registration that outlives the request which asked for
 * it.
 *
 * It reports three facts and derives none of its own. `progress` is the single
 * value a surface renders; `record` is the existing registration projection,
 * reused rather than reshaped, so a panel reads the same fields here it reads
 * from the list endpoint; `inFlight` is the neutral cross-kind signal, unchanged
 * from where invoicing and fiscalization share it.
 *
 * NOTHING HERE IS A PROMISE ABOUT THE FUTURE. There is no estimate, no elapsed
 * or remaining time, and no completion percentage, because OpenLinker observes
 * no steps between handing a sale to a provider and getting one answer back.
 * `inFlight.since` is a LOWER BOUND on how long an attempt has been running -
 * never its start - so a surface may say "running for at least" and must not
 * print a start time or count down to anything.
 *
 * @module apps/api/src/fiscalization/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
// Value import: the closed vocabulary is what publishes the contract, and the
// union annotates a decorated property, so the binding must survive erasure.
import {
  FiscalRegistrationProgress,
  FiscalRegistrationProgressValues,
} from '@openlinker/core/fiscalization';
// Value import for the same reason the two above are: the type annotates a
// decorated property, so the binding must survive erasure.
import { SalesDocumentKind } from '@openlinker/core/sales-documents';

import { FiscalRegistrationResponseDto } from './fiscal-registration-response.dto';

/**
 * A sales document is being produced for this order right now, on some
 * connection. Order-scoped where `progress` is connection-scoped.
 */
export class SalesDocumentInFlightDto {
  @ApiProperty({ description: 'Which document is being produced. Never inferred by the reader.' })
  documentKind!: SalesDocumentKind;

  @ApiProperty({ description: 'The connection whose provider is being called' })
  connectionId!: string;

  @ApiProperty({ description: 'The record holding the claim' })
  recordId!: string;

  @ApiProperty({
    description:
      'The claim-holding record`s last write. A LOWER BOUND on how long the attempt has been ' +
      'running, NOT its start: nothing persists a claim-start instant, and a write inside a live ' +
      'claim moves this forward. A surface may render an elapsed reading from it and must not ' +
      'render a start time, a countdown or an estimate.',
  })
  since!: string;
}

export class FiscalRegistrationProgressResponseDto {
  @ApiProperty({
    enum: FiscalRegistrationProgressValues,
    description:
      'not-requested = nobody has asked; ' +
      'queued = accepted and waiting, including the window before any record exists; ' +
      'running = an attempt holds the claim right now; ' +
      'stalled = intent was recorded and nothing is running, so asking again is what moves it; ' +
      'registered = the provider reports the sale registered; ' +
      'rejected = the provider definitely created nothing, so it is safe to ask again; ' +
      'in-doubt = the sale may already be registered and is NEVER re-sent automatically.',
  })
  progress!: FiscalRegistrationProgress;

  @ApiPropertyOptional({
    description:
      'The registration record on the queried connection, or null when none exists yet - which ' +
      'is the normal state while the work is queued, not an error.',
    type: FiscalRegistrationResponseDto,
    nullable: true,
  })
  record!: FiscalRegistrationResponseDto | null;

  @ApiPropertyOptional({
    description:
      'A document being produced for this order right now, on ANY connection; null when none is.',
    type: SalesDocumentInFlightDto,
    nullable: true,
  })
  inFlight!: SalesDocumentInFlightDto | null;
}
