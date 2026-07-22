/**
 * Numbering Audit Response DTOs (#8)
 *
 * Response shapes for the gap-audit read model: per-sequence outcomes
 * (issued / pending / abandoned / skipped) with gap flags and any recorded
 * explanation, plus roll-up counts. Mirrors the neutral `SeriesAudit` domain type
 * with `Date`s projected to ISO-8601 strings. Country-agnostic (ADR-026): the gap
 * explanation is a neutral free-text string.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { NumberingSeqStatusValues } from '@openlinker/core/invoicing';
// Value import (not `import type`): the property type feeds decorator metadata.
import { NumberingSeqStatus } from '@openlinker/core/invoicing';

export class NumberingGapNoteResponseDto {
  @ApiProperty({ description: 'Gap-note id (UUID)' })
  id!: string;

  @ApiProperty({ description: 'Numbering series id the note belongs to' })
  seriesId!: string;

  @ApiProperty({ description: 'The sequence integer this note explains' })
  seq!: number;

  @ApiProperty({ description: 'Rendered document number, when known', nullable: true, type: String })
  documentNumber!: string | null;

  @ApiProperty({ description: 'Free-text neutral explanation for the gap' })
  reason!: string;

  @ApiProperty({ description: 'User who recorded the explanation', nullable: true, type: String })
  actorUserId!: string | null;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last-update timestamp (ISO 8601)' })
  updatedAt!: string;
}

export class SeriesAuditEntryResponseDto {
  @ApiProperty({ description: 'The sequence integer' })
  seq!: number;

  @ApiProperty({ description: 'Resolved outcome of this integer', enum: NumberingSeqStatusValues })
  status!: NumberingSeqStatus;

  @ApiProperty({ description: 'True when the outcome is abandoned or skipped (a gap)' })
  isGap!: boolean;

  @ApiProperty({ description: 'Rendered document number, null for a skipped integer', nullable: true, type: String })
  documentNumber!: string | null;

  @ApiProperty({ description: 'Invoice record id, null for a skipped integer', nullable: true, type: String })
  recordId!: string | null;

  @ApiProperty({ description: 'Order id, null for a skipped integer', nullable: true, type: String })
  orderId!: string | null;

  @ApiProperty({ description: 'Issuance timestamp (ISO 8601), null when not issued', nullable: true, type: String })
  issuedAt!: string | null;

  @ApiProperty({ description: 'Record creation timestamp (ISO 8601), null for a skipped integer', nullable: true, type: String })
  createdAt!: string | null;

  @ApiProperty({ description: 'Record update timestamp (ISO 8601), null for a skipped integer', nullable: true, type: String })
  updatedAt!: string | null;

  @ApiProperty({ description: 'Recorded explanation for this gap, when present', nullable: true, type: NumberingGapNoteResponseDto })
  note!: NumberingGapNoteResponseDto | null;
}

export class SeriesAuditSummaryResponseDto {
  @ApiProperty({ description: 'Successfully-issued sequence integers' })
  issuedCount!: number;

  @ApiProperty({ description: 'In-flight (pending/issuing) consumed integers' })
  pendingCount!: number;

  @ApiProperty({ description: 'Consumed integers whose record ended terminal-non-issued' })
  abandonedCount!: number;

  @ApiProperty({ description: 'Integers with no record inside the consumed range (non-resetting only)' })
  skippedCount!: number;

  @ApiProperty({ description: 'Total gaps (abandoned + skipped)' })
  gapCount!: number;

  @ApiProperty({ description: 'Gaps that carry a recorded explanation' })
  explainedGapCount!: number;
}

export class SeriesAuditResponseDto {
  @ApiProperty({ description: 'Numbering series id' })
  seriesId!: string;

  @ApiProperty({ description: 'Numbering series name' })
  seriesName!: string;

  @ApiProperty({ description: 'Whether skipped-integer inference ran (non-resetting series only)' })
  skippedInferenceApplied!: boolean;

  @ApiProperty({ description: 'Roll-up counts', type: SeriesAuditSummaryResponseDto })
  summary!: SeriesAuditSummaryResponseDto;

  @ApiProperty({ description: 'Per-sequence audit entries (ascending)', type: [SeriesAuditEntryResponseDto] })
  entries!: SeriesAuditEntryResponseDto[];
}
