/**
 * Reconcile Fiscal Registration Response DTO (#1908)
 *
 * Outcome of asking the provider whether an indeterminate registration actually
 * landed.
 *
 * `outcome` is reported alongside the record rather than folded into it, because
 * "the provider holds no match", "the provider cannot be asked" and "the
 * provider has it and has not registered it yet" leave the record in the SAME
 * state (`in-doubt`) while meaning very different things to an operator - and
 * none of the three licenses a resend.
 *
 * @module apps/api/src/fiscalization/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
// Value import on purpose: `FiscalReconcileOutcomeValues` is what publishes the
// CLOSED set to the contract, and `FiscalReconcileOutcome` annotates a decorated
// property, so `emitDecoratorMetadata` needs the binding to survive erasure.
import {
  FiscalReconcileOutcome,
  FiscalReconcileOutcomeValues,
} from '@openlinker/core/fiscalization';

import { FiscalRegistrationResponseDto } from './fiscal-registration-response.dto';

export class ReconcileFiscalRegistrationResponseDto {
  @ApiProperty({
    enum: FiscalReconcileOutcomeValues,
    description:
      'resolved = the provider confirmed a registration and the record advanced; ' +
      'not-found = the provider holds no match, so the record stays in doubt for an operator; ' +
      'unsupported = this provider cannot be queried by business coordinates; ' +
      'still-unknown = the provider HOLDS the sale but has not registered it yet, so the record ' +
      'is left exactly where it was and the check can be repeated later.',
  })
  outcome!: FiscalReconcileOutcome;

  @ApiProperty({ type: FiscalRegistrationResponseDto })
  record!: FiscalRegistrationResponseDto;
}
