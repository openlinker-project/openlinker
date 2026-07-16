/**
 * Update Numbering Series Request DTO (#1576, C2)
 *
 * Body for `PATCH /invoicing/numbering-series/:seriesId`. Every field is
 * optional — a partial patch. Structural validation only; the effective
 * pattern↔reset-policy coverage is re-checked by the controller through the C1
 * domain validator against the merged (existing + patch) values. Numbers already
 * issued are immutable at the repository level; lowering `nextSeq` is permitted
 * (a migration use case).
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { DocumentTypeValues, ResetPolicyValues } from '@openlinker/core/invoicing';
// Value imports (not `import type`): the property types feed decorator metadata.
import { DocumentType, ResetPolicy } from '@openlinker/core/invoicing';

export class UpdateNumberingSeriesRequestDto {
  @ApiPropertyOptional({ description: 'Human-readable series name', example: 'Sales invoices 2026' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'Number pattern of positional variables ({seq}, {YYYY}, {YY}, {MM}, {QQ})',
    example: 'FV/{YYYY}/{seq}',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pattern?: string;

  @ApiPropertyOptional({ description: 'The next sequence number to allocate', example: 42, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  nextSeq?: number;

  @ApiPropertyOptional({ description: 'Zero-pad width for {seq} (0 = no padding)', example: 5, minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  seqPadding?: number;

  @ApiPropertyOptional({ description: 'Reset cadence of the sequence counter', enum: ResetPolicyValues })
  @IsOptional()
  @IsIn(ResetPolicyValues)
  resetPolicy?: ResetPolicy;

  @ApiPropertyOptional({
    description: 'Neutral document type this series numbers (invoice / corrected / …)',
    enum: DocumentTypeValues,
  })
  @IsOptional()
  @IsIn(DocumentTypeValues)
  documentType?: DocumentType;

  @ApiPropertyOptional({
    description: 'Neutral register / entity scope; null = the register-less default.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @IsNotEmpty()
  register?: string | null;

  @ApiPropertyOptional({
    description:
      'Calendar month (1-12) the fiscal year starts on, governing {FY}. 1 = calendar year.',
    example: 1,
    minimum: 1,
    maximum: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;
}
