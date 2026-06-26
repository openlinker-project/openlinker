/**
 * Retry Invoices Request DTO (#1245)
 *
 * Body for `POST /invoices/retry` (§7.2): the set of `InvoiceRecord` ids to
 * re-attempt. Only records that are retry-eligible
 * (`status === 'failed' && failureMode === 'rejected'`) are retried; every other
 * state (issued / issuing / pending / in-doubt / unknown) is skipped server-side
 * with a per-id reason. Neutral — no provider vocabulary.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Max ids accepted in one batch. Bounds the synchronous fan-out (each id may
 * cross the provider boundary) so a single request can't issue an unbounded
 * number of provider calls.
 */
const MAX_BATCH_SIZE = 100;

export class RetryInvoicesRequestDto {
  @ApiProperty({
    description: 'Invoice record ids to re-attempt (only failed+rejected records are retried).',
    type: [String],
    maxItems: MAX_BATCH_SIZE,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @IsUUID('4', { each: true })
  invoiceIds!: string[];
}
