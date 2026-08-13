/**
 * Get Invoice For Order Query DTO (#1119, connectionId made optional by #2047)
 *
 * Query parameters for GET /orders/:orderId/invoice.
 *
 * `connectionId` is OPTIONAL. Supplied, it reads the projection keyed
 * `(orderId, connectionId)` — exactly the pre-#2047 behaviour, and the same key
 * POST /invoices writes the row under. OMITTED, the endpoint answers the
 * question the UI actually has: "does this order have an invoice ANYWHERE?",
 * returning the order's most recent record whichever connection it lives on.
 *
 * Requiring it was the root cause of the #2047 defect: the order-detail panel had
 * to ask the operator for a connection first, and switching that picker asked
 * "…on THIS connection?" of an already-invoiced order, got a 404, and rendered
 * "not issued" with an Issue affordance — an invitation to issue a second
 * document for one sale. (An OrderRecord still carries only its
 * `sourceConnectionId` — the originating marketplace — so the invoicing
 * connection is never derived from the order; it is read off the record.)
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetInvoiceForOrderQueryDto {
  @ApiPropertyOptional({
    description:
      'Invoicing connection id the invoice was issued on (the same id POST /invoices wrote the ' +
      'record under). Omit to resolve the invoice on whichever connection holds it.',
  })
  @IsOptional()
  @IsUUID()
  connectionId?: string;
}
