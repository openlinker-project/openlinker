/**
 * Adopt Sales-Document Template DTO (#2170)
 *
 * The operator's per-slot connection selections for the "Review & adopt"
 * flow — see `apps/api/src/sales-documents/data/sales-document-template-catalogue.ts` for
 * the slot vocabulary. Adopting writes ORDINARY, fully-editable rows via the
 * same `createRule` path every other rule goes through, tagged with the
 * template's provenance string.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SalesDocumentTemplateSlotSelectionDto {
  @ApiProperty()
  @IsString()
  slot!: string;

  @ApiProperty()
  @IsUUID()
  connectionId!: string;
}

export class AdoptSalesDocumentTemplateDto {
  @ApiProperty({ type: [SalesDocumentTemplateSlotSelectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesDocumentTemplateSlotSelectionDto)
  selections!: SalesDocumentTemplateSlotSelectionDto[];
}
