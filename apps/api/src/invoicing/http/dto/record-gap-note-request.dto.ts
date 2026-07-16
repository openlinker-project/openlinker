/**
 * Record Gap-Note Request DTO (#8)
 *
 * Body for `POST /invoicing/numbering-series/:seriesId/gap-notes`. Records the
 * operator's neutral written explanation for a numbering gap (a sequence integer
 * whose record was abandoned, or a skipped integer). The `reason` non-empty rule
 * is enforced structurally here AND in the core service (which trims + rejects
 * blank), so a whitespace-only reason maps to 400.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class RecordGapNoteRequestDto {
  @ApiProperty({ description: 'The sequence integer this note explains', minimum: 1, example: 42 })
  @IsInt()
  @Min(1)
  seq!: number;

  @ApiPropertyOptional({
    description: 'Rendered document number of the abandoned record, when known.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  documentNumber?: string | null;

  @ApiProperty({ description: 'Free-text neutral explanation for the gap' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
