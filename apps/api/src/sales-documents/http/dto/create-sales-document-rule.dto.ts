/**
 * Create Sales-Document Rule DTO (#2170)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CoreSalesDocumentKindValues, type SalesDocumentKind } from '@openlinker/core/sales-documents';
import { SalesDocumentConditionDto } from './sales-document-condition.dto';

export class CreateSalesDocumentRuleDto {
  @ApiProperty({ description: "ISO 3166-1 alpha-2, or '*' for Rest of world" })
  @IsString()
  @IsNotEmpty()
  // `sales_document_rules.country` is `varchar(8)` — without this an
  // oversized value surfaces as a raw DB error (500) instead of a clean 400
  // (review, optional improvements).
  @MaxLength(8)
  country!: string;

  @ApiProperty({ type: [SalesDocumentConditionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesDocumentConditionDto)
  conditions!: SalesDocumentConditionDto[];

  @ApiProperty({ enum: CoreSalesDocumentKindValues })
  @IsIn(CoreSalesDocumentKindValues)
  documentKind!: SalesDocumentKind;

  @ApiProperty()
  @IsUUID()
  connectionId!: string;

  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  provenance?: string | null;
}
