/**
 * Batch issuing DTOs (#3583)
 *
 * Responses for the batch-issuing surface (mockup M15): the connection's
 * schedules and next slots, its queue, its run history and one run's per-order
 * outcomes. Every status and reason is a CODE; the copy is the frontend's.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class BatchScheduleDto {
  @ApiProperty({ enum: ['invoice', 'fiscal-receipt'] })
  documentKind!: string;

  @ApiProperty({
    description:
      "Whether this kind's effective trigger model is `batched`. A schedule on a kind that is " +
      'not batched is kept but never runs.',
  })
  batched!: boolean;

  @ApiPropertyOptional({ enum: ['daily', 'every-n-hours', 'month-end'], nullable: true })
  frequency!: string | null;

  @ApiPropertyOptional({ description: 'HH:MM in `timeZone` (daily).', nullable: true })
  time!: string | null;

  @ApiPropertyOptional({ nullable: true })
  everyHours!: number | null;

  @ApiPropertyOptional({
    description: 'IANA zone the times are read in, stored with the schedule (default Europe/Warsaw).',
    nullable: true,
  })
  timeZone!: string | null;

  @ApiProperty({
    type: [Object],
    description:
      'Next slot per segment: `all`, or `b2b` (month end) and `b2c` (the daily run that issues ' +
      'consumer orders on a month-end schedule, D42). Runs within 5 minutes of the slot.',
  })
  nextSlots!: Array<{ segment: string; slotAt: string }>;
}

export class SalesDocumentBatchRunDto {
  @ApiProperty() id!: string;
  @ApiProperty() connectionId!: string;
  @ApiProperty({ enum: ['schedule', 'manual'] }) trigger!: string;
  @ApiProperty({ type: [String] }) documentKinds!: string[];
  @ApiProperty({ enum: ['all', 'b2b', 'b2c'] }) segment!: string;
  @ApiPropertyOptional({ nullable: true }) slotAt!: string | null;
  @ApiProperty({ enum: ['running', 'completed', 'empty', 'failed-to-start', 'interrupted'] })
  status!: string;
  @ApiPropertyOptional({
    enum: ['connection-not-found', 'connection-needs-reauth', 'connection-not-active', 'queue-read-failed'],
    nullable: true,
  })
  failureReason!: string | null;
  @ApiProperty() eligibleCount!: number;
  @ApiProperty() enqueuedCount!: number;
  @ApiProperty() blockedCount!: number;
  @ApiProperty() startedAt!: string;
  @ApiPropertyOptional({ nullable: true }) finishedAt!: string | null;
}

export class SalesDocumentBatchOverviewDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty({ type: [BatchScheduleDto] }) schedules!: BatchScheduleDto[];
  @ApiProperty({ description: 'Queued orders per document kind.' })
  queueCounts!: Record<string, number>;
  @ApiPropertyOptional({ type: SalesDocumentBatchRunDto, nullable: true })
  runningRun!: SalesDocumentBatchRunDto | null;
}

export class SalesDocumentBatchQueueEntryDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() sourceConnectionId!: string;
  @ApiProperty() documentKind!: string;
  @ApiPropertyOptional({ nullable: true }) placedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) totalAmount!: number | null;
  @ApiPropertyOptional({ nullable: true }) currency!: string | null;
  @ApiProperty({ description: 'Buyer has a tax id; a month-end run issues these only (D42).' })
  isB2b!: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Source order number.' })
  orderNumber!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Buyer name; null when absent or personal data is not stored.',
  })
  buyerName!: string | null;
}

export class SalesDocumentBatchQueueDto {
  @ApiProperty({ type: [SalesDocumentBatchQueueEntryDto] }) items!: SalesDocumentBatchQueueEntryDto[];
  @ApiPropertyOptional({ description: 'Pass as `after` for the next page.', nullable: true })
  nextCursor!: string | null;
}

export class SalesDocumentBatchRunListDto {
  @ApiProperty({ type: [SalesDocumentBatchRunDto] }) runs!: SalesDocumentBatchRunDto[];
  @ApiProperty() total!: number;
}

export class SalesDocumentBatchRunItemDto {
  @ApiProperty() orderId!: string;
  @ApiPropertyOptional({ nullable: true }) documentKind!: string | null;
  @ApiProperty({
    enum: ['enqueued', 'blocked', 'already-documented', 'not-routed-here', 'indeterminate'],
    description: 'What the run did with the order.',
  })
  result!: string;
  @ApiProperty({
    enum: ['issued', 'pending', 'in-doubt', 'failed', 'blocked', 'skipped', 'needs-attention'],
    description:
      "The order's outcome NOW, read from its documents (never stored with the run). `in-doubt` " +
      'means the provider did not answer and a retry cannot duplicate the document.',
  })
  outcome!: string;
  @ApiPropertyOptional({ nullable: true }) blockReason!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Source order number.' })
  orderNumber!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Buyer name; null when absent or personal data is not stored.',
  })
  buyerName!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'The number the issued document bears; null until one is assigned.',
  })
  documentNumber!: string | null;
}

export class SalesDocumentBatchRunDetailDto {
  @ApiProperty({ type: SalesDocumentBatchRunDto }) run!: SalesDocumentBatchRunDto;
  @ApiProperty({ type: [SalesDocumentBatchRunItemDto] }) items!: SalesDocumentBatchRunItemDto[];
}

export class StartSalesDocumentBatchRunResponseDto {
  @ApiProperty({ description: 'The run job enqueued; the run row appears when the worker starts it.' })
  jobId!: string;
}

export class SalesDocumentBatchQueueQueryDto {
  @ApiPropertyOptional({ enum: ['invoice', 'fiscal-receipt'] })
  @IsOptional()
  @IsIn(['invoice', 'fiscal-receipt'])
  documentKind?: 'invoice' | 'fiscal-receipt';

  @ApiPropertyOptional({ description: 'Cursor from the previous page.' })
  @IsOptional()
  @IsString()
  after?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class SalesDocumentBatchRunListQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
