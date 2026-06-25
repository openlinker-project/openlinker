/**
 * Get Invoice For Order Query DTO (#1119)
 *
 * Query parameters for GET /orders/:orderId/invoice. The invoicing
 * `connectionId` is REQUIRED — symmetric with how POST /invoices writes the
 * InvoiceRecord row. It is NOT derivable from the order: an OrderRecord carries
 * only its `sourceConnectionId` (the originating marketplace), which is a
 * distinct capability from the Invoicing connection the invoice was issued on,
 * so deriving the lookup key from the order would 404 every real invoice.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetInvoiceForOrderQueryDto {
  @ApiProperty({
    description:
      'Invoicing connection id the invoice was issued on (the same id POST /invoices wrote the record under)',
  })
  @IsUUID()
  connectionId!: string;
}
