/**
 * Upsert Sales-Document Country Default DTO (#2170)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CoreSalesDocumentKindValues, type SalesDocumentKind } from '@openlinker/core/sales-documents';

export class UpsertSalesDocumentCountryDefaultDto {
  @ApiProperty({ description: "ISO 3166-1 alpha-2, or '*' for Rest of world" })
  @IsString()
  @IsNotEmpty()
  // `sales_document_country_defaults.country` is `varchar(8)` — without this
  // an oversized value surfaces as a raw DB error (500) instead of a clean
  // 400 (review, optional improvements).
  @MaxLength(8)
  country!: string;

  @ApiProperty({ enum: CoreSalesDocumentKindValues })
  @IsIn(CoreSalesDocumentKindValues)
  documentKind!: SalesDocumentKind;

  @ApiProperty()
  @IsUUID()
  connectionId!: string;
}
