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
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { ResetPolicyValues } from '@openlinker/core/invoicing';
// Value import (not `import type`): the property type feeds decorator metadata.
import { ResetPolicy } from '@openlinker/core/invoicing';

export class CreateNumberingSeriesRequestDto {
  @ApiProperty({ description: 'Human-readable series name', example: 'Sales invoices 2026' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Number pattern of positional variables ({seq}, {YYYY}, {YY}, {MM}, {QQ})',
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
}
