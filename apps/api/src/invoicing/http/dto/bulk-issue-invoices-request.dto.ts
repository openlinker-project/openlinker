/**
 * Bulk Issue Invoices Request DTO (#1355)
 *
 * Body for `POST /invoices/bulk-issue`: one invoicing `connectionId` plus the
 * set of internal `orderIds` to issue documents for. Mirrors the batch shape of
 * `RetryInvoicesRequestDto` (§7.2) — same max-100 fan-out cap so a single
 * request can't cross the provider boundary an unbounded number of times.
 *
 * Order ids are OpenLinker-internal ids (`ol_order_*`), NOT UUIDs, so they are
 * validated as non-empty strings (matching the single `POST /invoices`
 * `orderId` field), not `@IsUUID`.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Max order ids accepted in one batch. Bounds the synchronous fan-out (each id
 * may cross the provider boundary once) — identical cap to bulk retry.
 */
const MAX_BATCH_SIZE = 100;

export class BulkIssueInvoicesRequestDto {
  @ApiProperty({ description: 'Invoicing connection id to issue the documents on.' })
  @IsUUID()
  connectionId!: string;

  @ApiProperty({
    description: 'Internal order ids to issue invoices for.',
    type: [String],
    maxItems: MAX_BATCH_SIZE,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderIds!: string[];
}
