/**
 * Dry-Run Sales-Document Rule DTO (#3191)
 *
 * Request shape for `POST /sales-documents/rules/dry-run` — an in-progress,
 * never-persisted rule candidate plus the sample order to test it against.
 * Mirrors `CreateSalesDocumentRuleDto`'s scoping fields (`country` /
 * `conditions` / `documentKind` / `connectionId`) but carries neither an
 * effective window nor a `provenance`: a dry run tests conditions, not a
 * calendar, and produces nothing an audit tag could attach to.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  CoreSalesDocumentKindValues,
  SalesDocumentOrderTaxTreatmentValues,
  type SalesDocumentKind,
  type SalesDocumentOrderTaxTreatment,
} from '@openlinker/core/sales-documents';
import { SalesDocumentConditionDto } from './sales-document-condition.dto';

/** Wire shape for the `sampleOrder` — mirrors `SalesDocumentOrderFacts` (core). */
export class SalesDocumentDryRunSampleOrderDto {
  @ApiProperty({ description: 'Delivery country, ISO 3166-1 alpha-2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  country!: string;

  @ApiProperty({ description: "The order's gross (tax-inclusive) total, in `currency`" })
  @IsNumber()
  totalGross!: number;

  @ApiProperty({ example: 'PLN' })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiProperty({
    required: false,
    enum: SalesDocumentOrderTaxTreatmentValues,
    description: 'Absent means "not asserted by the source" — never defaulted.',
  })
  @IsOptional()
  @IsIn(SalesDocumentOrderTaxTreatmentValues)
  taxTreatment?: SalesDocumentOrderTaxTreatment;

  @ApiProperty({
    required: false,
    description:
      'Whether the buyer carries a tax identifier. Absent means "unknown" — never defaulted to false.',
  })
  @IsOptional()
  @IsBoolean()
  buyerHasTaxId?: boolean;
}

export class DryRunSalesDocumentRuleDto {
  @ApiProperty({ description: "The country (or '*') this candidate rule would be scoped to once saved" })
  @IsString()
  @IsNotEmpty()
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

  @ApiProperty({ type: SalesDocumentDryRunSampleOrderDto })
  @ValidateNested()
  @Type(() => SalesDocumentDryRunSampleOrderDto)
  sampleOrder!: SalesDocumentDryRunSampleOrderDto;
}
