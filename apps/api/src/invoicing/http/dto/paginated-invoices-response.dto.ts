/**
 * Paginated Invoices Response DTO (#1119)
 *
 * Response shape for GET /invoices. Mirrors the customers/orders pagination
 * envelope: `{ items, total, limit, offset }`.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { InvoiceRecordResponseDto } from './invoice-record-response.dto';

export class PaginatedInvoicesResponseDto {
  @ApiProperty({ type: [InvoiceRecordResponseDto] })
  items!: InvoiceRecordResponseDto[];

  @ApiProperty({ description: 'Total number of invoice records matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
