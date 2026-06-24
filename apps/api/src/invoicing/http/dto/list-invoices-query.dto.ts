/**
 * List Invoices Query DTO (#1119)
 *
 * Query parameters for GET /invoices (AC-6). All fields optional.
 *
 * The AC-6 "with/without tax id" sub-filter is DELIBERATELY NOT exposed: the
 * persisted InvoiceRecord projection carries no buyer/tax-id column (the buyer
 * lives on the Order, never on the invoice projection), so the filter cannot be
 * served without a schema migration that is out of #1119 scope. It is omitted
 * from the public contract rather than accepted-and-ignored (which would mislead
 * a caller into thinking `hasTaxId=true` results were filtered). Tracked as a
 * #1119 follow-up so AC-6 sign-off is not claimed for an inert filter.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import {
  IsOptional,
  IsUUID,
  IsIn,
  IsISO8601,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  InvoiceStatus,
  InvoiceStatusValues,
  RegulatoryStatus,
  RegulatoryStatusValues,
} from '@openlinker/core/invoicing';

export class ListInvoicesQueryDto {
  @ApiPropertyOptional({ description: 'Filter by issuance status', enum: InvoiceStatusValues })
  @IsOptional()
  @IsIn(InvoiceStatusValues)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ description: 'Filter by invoicing connection id' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({
    description: 'Filter by neutral CTC clearance status',
    enum: RegulatoryStatusValues,
  })
  @IsOptional()
  @IsIn(RegulatoryStatusValues)
  regulatoryStatus?: RegulatoryStatus;

  @ApiPropertyOptional({ description: 'Inclusive lower bound on issuedAt (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  issuedFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound on issuedAt (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  issuedTo?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
