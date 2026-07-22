/**
 * Create Numbering Series Request DTO (#1576, C2)
 *
 * Body for `POST /invoicing/numbering-series`. Structural validation only
 * (types, ranges, non-empty). The pattern↔reset-policy coverage rule (`{seq}`
 * required, period disambiguation) is NOT duplicated here — the controller calls
 * the C1 domain validator `assertValidNumberingPattern` and maps its
 * `InvalidNumberingPatternException` to a 400.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateNumberingSeriesRequestDto {
  @ApiProperty({ description: 'Human-readable series name', example: 'Sales invoices 2026' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Number pattern of positional variables ({seq}, {YYYY}, {YY}, {MM}, {QQ}, {DD}, {FY})',
    example: 'FV/{YYYY}/{seq}',
  })
  @IsString()
  @IsNotEmpty()
  pattern!: string;

  @ApiProperty({ description: 'The next sequence number to allocate', example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  nextSeq!: number;

  @ApiProperty({ description: 'Zero-pad width for {seq} (0 = no padding)', example: 5, minimum: 0, maximum: 20 })
  @IsInt()
  @Min(0)
  @Max(20)
  seqPadding!: number;

  @ApiProperty({ description: 'Reset cadence of the sequence counter', enum: ResetPolicyValues })
  @IsIn(ResetPolicyValues)
  resetPolicy!: ResetPolicy;

  @ApiProperty({
    description: 'Neutral document type this series numbers (invoice / corrected / …)',
    enum: DocumentTypeValues,
    example: 'invoice',
  })
  @IsIn(DocumentTypeValues)
  documentType!: DocumentType;

  @ApiPropertyOptional({
    description:
      'Optional neutral register / entity scope segmenting a connection into ' +
      'parallel series for the same document type. null = the register-less default.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  // Allow an explicit null (register-less default); otherwise require a non-empty string.
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @IsNotEmpty()
  register?: string | null;

  @ApiPropertyOptional({
    description:
      'Calendar month (1-12) the fiscal year starts on, governing {FY}. ' +
      '1 (default) = calendar year, so {FY} renders identically to {YYYY}.',
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
