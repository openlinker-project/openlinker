/**
 * Numbering Series Response DTOs (#1576, C2)
 *
 * Response shapes for the numbering-series HTTP surface. `NumberingSeriesResponseDto`
 * mirrors the neutral `InvoiceNumberingSeries` domain entity. The orphaned-series
 * variant adds a best-effort last-issued view for the C3 re-attach picker.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { DocumentTypeValues, ResetPolicyValues } from '@openlinker/core/invoicing';
// Value import (not `import type`): the property type feeds decorator metadata.
import { ResetPolicy } from '@openlinker/core/invoicing';

export class NumberingSeriesResponseDto {
  @ApiProperty({ description: 'Series id (UUID)' })
  id!: string;

  @ApiProperty({ description: 'Human-readable series name' })
  name!: string;

  @ApiProperty({ description: 'Number pattern of positional variables' })
  pattern!: string;

  @ApiProperty({ description: 'The next sequence number that will be allocated' })
  nextSeq!: number;

  @ApiProperty({ description: 'Zero-pad width applied to {seq} (0 = no padding)' })
  seqPadding!: number;

  @ApiProperty({ description: 'Reset cadence of the sequence counter', enum: ResetPolicyValues })
  resetPolicy!: ResetPolicy;

  @ApiProperty({ description: 'Neutral document type this series numbers (open-world)', enum: DocumentTypeValues })
  documentType!: string;

  @ApiProperty({
    description: 'Neutral register / entity scope; null = the register-less default',
    nullable: true,
    type: String,
  })
  register!: string | null;

  @ApiProperty({ description: 'Opaque marker of the period nextSeq belongs to (empty for none)' })
  periodKey!: string;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last-update timestamp (ISO 8601)' })
  updatedAt!: string;
}

export class UnassignedNumberingSeriesResponseDto extends NumberingSeriesResponseDto {
  @ApiProperty({
    description: 'The last allocated sequence (nextSeq - 1); null when nothing has been issued yet',
    nullable: true,
    type: Number,
  })
  lastIssuedSeq!: number | null;

  @ApiProperty({
    description:
      'Best-effort render of the last issued number (using the last-update date for date variables); ' +
      'null when nothing has been issued yet. A display hint for the re-attach picker, not a fiscal record.',
    nullable: true,
    type: String,
  })
  lastIssuedNumberPreview!: string | null;
}
