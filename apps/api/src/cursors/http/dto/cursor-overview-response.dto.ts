/**
 * Cursor Overview Response DTOs (#4023)
 *
 * Response shape for GET /cursors/overview. Dates are ISO-8601 strings.
 *
 * @module apps/api/src/cursors/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CursorFamilyValues, CursorRewindTargetValues } from '@openlinker/core/sync';
import type { CursorFamily, CursorRewindTarget } from '@openlinker/core/sync';

export class CursorLastRunDto {
  @ApiProperty() jobId!: string;
  @ApiProperty({ description: 'Job type that advances this cursor' }) jobType!: string;
  @ApiProperty({ enum: ['queued', 'running', 'succeeded', 'dead'] }) status!: string;
  @ApiPropertyOptional({ nullable: true, enum: ['ok', 'business_failure'] }) outcome!: string | null;
  @ApiProperty({ description: 'When the run last changed state' }) at!: string;
  @ApiPropertyOptional({ nullable: true }) lastError!: string | null;
}

export class CursorOverviewItemDto {
  @ApiProperty() cursorKey!: string;
  @ApiProperty({ description: 'Raw value. An empty string after a catalogue pass completes is the normal resting state.' })
  value!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiPropertyOptional({ nullable: true, enum: CursorFamilyValues, description: 'Null for a key this build does not recognise' })
  family!: CursorFamily | null;
  @ApiPropertyOptional({ nullable: true, enum: CursorRewindTargetValues, description: 'The one target POST /cursors/:connectionId/rewind accepts for this key, or null' })
  rewind!: CursorRewindTarget | null;
  @ApiPropertyOptional({ nullable: true, type: CursorLastRunDto, description: 'Newest run of the job that advances this cursor, whatever its status' })
  lastRun!: CursorLastRunDto | null;
}

export class CursorWriteMarksSummaryDto {
  @ApiProperty() keyPrefix!: string;
  @ApiProperty() count!: number;
  @ApiProperty() oldestValue!: string;
  @ApiProperty() newestValue!: string;
  @ApiProperty() lastUpdatedAt!: string;
}

export class CursorOverviewConnectionDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty({ type: [CursorOverviewItemDto] }) cursors!: CursorOverviewItemDto[];
  @ApiPropertyOptional({ nullable: true, type: CursorWriteMarksSummaryDto, description: 'Per-listing stock write marks, summarised. Page through them with GET /cursors?keyPrefix=' })
  writeMarks!: CursorWriteMarksSummaryDto | null;
}

export class CursorOverviewResponseDto {
  @ApiProperty({ type: [CursorOverviewConnectionDto] }) connections!: CursorOverviewConnectionDto[];
  @ApiProperty({ description: 'True when more cursors exist than the overview read' }) truncated!: boolean;
}
