/**
 * Accepted Fiscal Registration Response DTO (#2525)
 *
 * The answer to `POST /fiscal-registrations`, which now ACCEPTS a registration
 * rather than performing one.
 *
 * It deliberately carries no status, no record and no outcome. The endpoint
 * previously returned the registration record, and a caller could read a
 * completed act out of the response of the request that asked for it. That is no
 * longer true at any point in this response's life: when it is sent, a job row
 * exists and nothing has been sent to a provider. A caller learns the outcome by
 * reading the order's registration state.
 *
 * There is likewise no field expressing when the answer will arrive. OpenLinker
 * hands the sale to a provider and waits for one answer; it observes no steps in
 * between and can promise no deadline.
 *
 * @module apps/api/src/fiscalization/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class AcceptedFiscalRegistrationResponseDto {
  @ApiProperty({ description: 'The order whose sale was accepted for registration' })
  orderId!: string;

  @ApiProperty({ description: 'The fiscalization connection it will be registered on' })
  connectionId!: string;

  @ApiProperty({
    description:
      'The exactly-once key this request is held under. Derived from (connection, order) and ' +
      'never caller-supplied, so a repeat of this request joins the same work rather than ' +
      'starting a second registration of the same sale.',
  })
  idempotencyKey!: string;

  @ApiProperty({
    description:
      'The enqueued registration job. A repeated request returns the id of the job the first ' +
      'one created rather than a second job.',
  })
  jobId!: string;

  @ApiProperty({
    description:
      'True when this request restarted a job that had exhausted its retries, rather than ' +
      'enqueueing or joining a live one. Says nothing about whether the sale is registered.',
  })
  redrivenFromDead!: boolean;
}
