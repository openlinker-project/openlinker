/**
 * Issue Invoice Request DTO (#1119)
 *
 * Body for POST /invoices (manual issue / re-issue, AC-5). The client supplies
 * ONLY the connection + order + optional B2B tax id / documentType /
 * idempotencyKey — NEVER buyer/lines. The controller composes the full
 * `IssueInvoiceCommand` server-side by loading the core Order and running the
 * existing mapper. `documentType` is a PASS-THROUGH (no faktura/paragon/NIP
 * vocabulary in the API layer).
 *
 * @module apps/api/src/invoicing/http/dto
 */
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BuyerTaxIdDto } from './buyer-tax-id.dto';
import { AcknowledgeWarningsProperty } from './acknowledge-warnings.dto';
import {
  ANNOTATION_LIST_LIMIT,
  AdditionalPartyDto,
  InvoiceAnnotationsDto,
  LineClassificationDto,
} from './issue-invoice-annotations.dto';

export class IssueInvoiceRequestDto {
  @ApiProperty({ description: 'Invoicing connection id' })
  @IsUUID()
  connectionId!: string;

  @ApiProperty({ description: 'Internal order id to issue a document for' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiPropertyOptional({
    description: 'Scheme-tagged buyer tax id; presence drives B2B (company), absence B2C (private)',
    type: BuyerTaxIdDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BuyerTaxIdDto)
  buyerTaxId?: BuyerTaxIdDto;

  @ApiPropertyOptional({ description: 'Neutral document type (pass-through; adapter derives if absent)' })
  @IsOptional()
  @IsString()
  documentType?: string;

  @ApiPropertyOptional({ description: 'Caller-controlled exactly-once key for issue/re-issue' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @AcknowledgeWarningsProperty()
  acknowledgeWarnings?: string[];

  @ApiPropertyOptional({
    description:
      'Operator flag: the buyer is a public-sector / local-government entity (#1580). ' +
      'Neutral classification the provider maps to its regime (KSeF → FA(3) JST). Absent ⇒ does not apply.',
  })
  @IsOptional()
  @IsBoolean()
  buyerIsPublicSectorEntity?: boolean;

  @ApiPropertyOptional({
    description:
      'Operator flag: the buyer is a VAT-group member (#1580). Neutral classification ' +
      'the provider maps to its regime (KSeF → FA(3) GV). Absent ⇒ does not apply.',
  })
  @IsOptional()
  @IsBoolean()
  buyerIsTaxGroupMember?: boolean;

  @ApiPropertyOptional({
    type: InvoiceAnnotationsDto,
    description: "Fiscal annotations for this sale (DEF-20); override the connection's defaults.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceAnnotationsDto)
  annotations?: InvoiceAnnotationsDto;

  @ApiPropertyOptional({ type: [AdditionalPartyDto], description: 'Parties besides seller and buyer (DEF-30)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ANNOTATION_LIST_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => AdditionalPartyDto)
  additionalParties?: AdditionalPartyDto[];

  @ApiPropertyOptional({ type: [LineClassificationDto], description: 'Per-line GTU / procedure markers (DEF-20)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ANNOTATION_LIST_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => LineClassificationDto)
  lineClassifications?: LineClassificationDto[];
}
