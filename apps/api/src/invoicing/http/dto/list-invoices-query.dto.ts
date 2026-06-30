/**
 * List Invoices Query DTO (#1119, #1202)
 *
 * Query parameters for GET /invoices (AC-6). All fields optional.
 *
 * The AC-6 "with/without tax id" sub-filter is exposed as `taxId=with|without`
 * (#1202): it is served by the neutral denormalized `hasBuyerTaxId` column on the
 * InvoiceRecord projection (set on the write path from the buyer at issue time),
 * so no Order join is needed. Neutral presence concept — not "nip".
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

  @ApiPropertyOptional({
    description:
      'Filter by buyer-tax-id presence: "with" keeps invoices whose buyer ' +
      'carried a tax id, "without" keeps those that did not.',
    enum: ['with', 'without'],
  })
  @IsOptional()
  @IsIn(['with', 'without'])
  taxId?: 'with' | 'without';

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
