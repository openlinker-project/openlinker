/**
 * Issue Correction Request DTO (#1241)
 *
 * Request body for `POST /invoices/:invoiceId/correct`. Carries only the
 * caller-supplied correction fields; `connectionId` / `orderId` /
 * `originalProviderInvoiceId` are resolved server-side from the original
 * `InvoiceRecord` identified by `:invoiceId`.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CorrectionLineDto {
  @ApiProperty({ description: '1-based line number of the original invoice line to correct.' })
  @IsNumber()
  @Min(1)
  originalLineNumber!: number;

  @ApiPropertyOptional({ description: 'New quantity (post-correction). Omit to leave quantity unchanged.' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  newQuantity?: number;

  @ApiPropertyOptional({ description: 'New gross unit price (post-correction). Omit to leave price unchanged.' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  newUnitPriceGross?: number;
}

export class IssueCorrectionRequestDto {
  @ApiPropertyOptional({ description: 'Free-text reason for correction (e.g. partial return).' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({ type: [CorrectionLineDto], description: 'Per-line corrections — at least one line must be present.' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CorrectionLineDto)
  lines!: CorrectionLineDto[];

  @ApiPropertyOptional({ description: 'Caller-supplied idempotency key for exactly-once issuance.' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
