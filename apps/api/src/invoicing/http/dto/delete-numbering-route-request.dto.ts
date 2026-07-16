/**
 * Delete Numbering Route Request DTO (#9/#10)
 *
 * Body for `DELETE /invoicing/connections/:connectionId/numbering-routes`.
 * Identifies the routing rule to detach by its `(documentType, register)` key.
 * The referenced series always survives — only the pointer is removed.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { DocumentTypeValues } from '@openlinker/core/invoicing';
// Value import (not `import type`): the property type feeds decorator metadata.
import { DocumentType } from '@openlinker/core/invoicing';

export class DeleteNumberingRouteRequestDto {
  @ApiProperty({ description: 'Neutral document type of the route to detach', enum: DocumentTypeValues })
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
}
