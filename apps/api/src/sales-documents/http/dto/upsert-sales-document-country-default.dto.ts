/**
 * Upsert Sales-Document Country Default DTO (#2170)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CoreSalesDocumentKindValues, type SalesDocumentKind } from '@openlinker/core/sales-documents';

export class UpsertSalesDocumentCountryDefaultDto {
  @ApiProperty({ description: "ISO 3166-1 alpha-2, or '*' for Rest of world" })
  @IsString()
  @IsNotEmpty()
  country!: string;

  @ApiProperty({ enum: CoreSalesDocumentKindValues })
  @IsIn(CoreSalesDocumentKindValues)
  documentKind!: SalesDocumentKind;

  @ApiProperty()
  @IsUUID()
  connectionId!: string;
}
