/**
 * Sales Documents Controller (#3306)
 *
 * `GET /sales-documents` - the merged, keyset-paginated cross-order list of
 * invoice and fiscal-receipt records. Backs the redesigned `/sales-documents`
 * frontend list (see `docs/plans/mockups/sales-documents.html`), which
 * `/invoices` (invoice-only, `InvoicingController`) could never serve.
 *
 * Delegates entirely to `ISalesDocumentViewService.listSalesDocuments` -
 * cross-context list seam, same discipline `InvoicingController`'s
 * `GET /invoices` follows for `IInvoiceService.listInvoices`. NEVER queries
 * the provider/adapter - this is a projection read.
 *
 * `@Roles('admin', 'operator', 'viewer')`, matching `GET /invoices` and
 * `GET /fiscal-registrations` - a row here carries no more than those two
 * already expose (order id, connection id, document status/identity,
 * native-currency amount), no buyer PII.
 *
 * @module apps/api/src/orders/http
 */
import { Controller, Get, HttpCode, HttpStatus, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ISalesDocumentViewService,
  SALES_DOCUMENT_VIEW_SERVICE_TOKEN,
  type SalesDocumentListCursor,
  type SalesDocumentListFilters,
} from '@openlinker/core/orders';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ListSalesDocumentsQueryDto } from './dto/list-sales-documents-query.dto';
import { PaginatedSalesDocumentsResponseDto } from './dto/paginated-sales-documents-response.dto';
import { toSalesDocumentListItemDto } from './dto/sales-document-list-item-response.dto';
import {
  decodeSalesDocumentListCursor,
  encodeSalesDocumentListCursor,
} from './sales-document-list-cursor.codec';

@ApiTags('Sales Documents')
@ApiBearerAuth()
@Controller()
export class SalesDocumentsController {
  constructor(
    @Inject(SALES_DOCUMENT_VIEW_SERVICE_TOKEN)
    private readonly salesDocumentView: ISalesDocumentViewService,
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get('sales-documents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List sales documents (invoices and fiscal receipts), merged',
    description:
      'Every invoice and fiscal-registration record across connections, newest-first, keyset-paginated ' +
      '(never OFFSET - a merged, financial-audit-adjacent list must not silently skip or duplicate a ' +
      'row when a new document lands mid-walk). An order with neither kind of record does not appear ' +
      '- fetch its routing state from `GET /orders/:internalOrderId/sales-document` instead.',
  })
  @ApiResponse({ status: 200, type: PaginatedSalesDocumentsResponseDto })
  @ApiResponse({ status: 400, description: 'Malformed cursor' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listSalesDocuments(
    @Query() query: ListSalesDocumentsQueryDto,
  ): Promise<PaginatedSalesDocumentsResponseDto> {
    const filters: SalesDocumentListFilters = {
      kind: query.kind,
      status: query.status,
      connectionId: query.connectionId,
      issuedFrom: query.issuedFrom ? new Date(query.issuedFrom) : undefined,
      issuedTo: query.issuedTo ? new Date(query.issuedTo) : undefined,
      taxId: query.taxId,
      search: query.search,
    };
    const cursor: SalesDocumentListCursor | undefined = decodeSalesDocumentListCursor(
      query.cursor,
    );

    const page = await this.salesDocumentView.listSalesDocuments(filters, {
      limit: query.limit ?? 20,
      cursor,
    });

    const exhausted = page.nextCursor.invoice === null && page.nextCursor.fiscal === null;
    return {
      items: page.items.map(toSalesDocumentListItemDto),
      nextCursor: exhausted ? null : encodeSalesDocumentListCursor(page.nextCursor),
    };
  }
}
