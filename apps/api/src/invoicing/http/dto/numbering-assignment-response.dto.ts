/**
 * Numbering Assignment Response DTO (#1576, C2)
 *
 * Response for the connection assignment reads/writes. Mirrors the neutral
 * `SeriesAssignmentData` shape from `@openlinker/core/invoicing`.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class NumberingAssignmentResponseDto {
  @ApiProperty({ description: 'Connection id the assignment belongs to' })
  connectionId!: string;

  @ApiProperty({ description: 'Main numbering series id' })
  mainSeriesId!: string;

  @ApiProperty({ description: 'Correction numbering series id, or null', nullable: true, type: String })
  correctionSeriesId!: string | null;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last-update timestamp (ISO 8601)' })
  updatedAt!: string;
}
