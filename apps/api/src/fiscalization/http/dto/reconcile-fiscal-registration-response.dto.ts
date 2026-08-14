/**
 * Reconcile Fiscal Registration Response DTO (#1908)
 *
 * Outcome of asking the provider whether an indeterminate registration actually
 * landed.
 *
 * `outcome` is reported alongside the record rather than folded into it, because
 * "the provider holds no match" and "the provider cannot be asked" leave the
 * record in the SAME state (`in-doubt`) while meaning very different things to
 * an operator - and neither licenses a resend.
 *
 * @module apps/api/src/fiscalization/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { FiscalReconcileOutcome } from '@openlinker/core/fiscalization';

import { FiscalRegistrationResponseDto } from './fiscal-registration-response.dto';

export class ReconcileFiscalRegistrationResponseDto {
  @ApiProperty({
    description:
      'resolved = the provider confirmed a registration and the record advanced; ' +
      'not-found = the provider holds no match, so the record stays in doubt for an operator; ' +
      'unsupported = this provider cannot be queried by business coordinates.',
  })
  outcome!: FiscalReconcileOutcome;

  @ApiProperty({ type: FiscalRegistrationResponseDto })
  record!: FiscalRegistrationResponseDto;
}
