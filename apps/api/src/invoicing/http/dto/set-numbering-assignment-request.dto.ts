/**
 * Set Numbering Assignment Request DTO (#1576, C2)
 *
 * Body for `PUT /invoicing/connections/:connectionId/numbering-assignment`.
 * Attaches a main numbering series and an optional correction series to a
 * connection. Referenced-series existence is validated by the controller (400
 * when an id is unknown), not here.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class SetNumberingAssignmentRequestDto {
  @ApiProperty({ description: 'Main numbering series id (UUID)' })
  @IsUUID()
  mainSeriesId!: string;

  @ApiPropertyOptional({
    description: 'Optional correction numbering series id (UUID). When absent, corrections draw from the main series.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  correctionSeriesId?: string | null;
}
