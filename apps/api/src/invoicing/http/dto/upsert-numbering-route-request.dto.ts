/**
 * Upsert Numbering Route Request DTO (#9/#10)
 *
 * Body for `PUT /invoicing/connections/:connectionId/numbering-routes`. Creates
 * or replaces the routing rule for a `(documentType, register)` pair on the
 * connection, pointing it at a numbering series. Referenced-series existence is
 * validated by the controller (400 when unknown), not here.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { DocumentTypeValues } from '@openlinker/core/invoicing';
// Value import (not `import type`): the property type feeds decorator metadata.
import { DocumentType } from '@openlinker/core/invoicing';

export class UpsertNumberingRouteRequestDto {
  @ApiProperty({ description: 'Neutral document type to route', enum: DocumentTypeValues, example: 'invoice' })
  @IsIn(DocumentTypeValues)
  documentType!: DocumentType;

  @ApiPropertyOptional({
    description: 'Neutral register / entity scope; omit or null for the register-less default route.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @IsNotEmpty()
  register?: string | null;

  @ApiProperty({ description: 'Numbering series id this document type routes to (UUID)' })
  @IsUUID()
  seriesId!: string;
}
