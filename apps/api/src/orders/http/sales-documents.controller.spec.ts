/**
 * SalesDocumentsController unit tests (#3306)
 *
 * @module apps/api/src/orders/http
 */
import type { ISalesDocumentViewService } from '@openlinker/core/orders';
import type { SalesDocumentRecordView } from '@openlinker/core/sales-documents';
import { SalesDocumentsController } from './sales-documents.controller';
import {
  decodeSalesDocumentListCursor,
  encodeSalesDocumentListCursor,
} from './sales-document-list-cursor.codec';

function invoiceDocument(): SalesDocumentRecordView {
  return {
    kind: 'invoice',
    documentType: 'VAT',
    status: 'issued',
    failureMode: null,
    failureCode: null,
    failureReason: null,
    regulatoryStatus: 'submitted',
    clearanceReference: null,
    identity: {
      recordId: 'inv-1',
      connectionId: 'conn-1',
      providerType: 'ksef',
      documentNumber: 'FA/1',
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      inFlightUntil: null,
    },
  };
}

describe('SalesDocumentsController', () => {
  let salesDocumentView: jest.Mocked<Pick<ISalesDocumentViewService, 'listSalesDocuments'>>;
  let controller: SalesDocumentsController;

  beforeEach(() => {
    salesDocumentView = { listSalesDocuments: jest.fn() };
    controller = new SalesDocumentsController(
      salesDocumentView as unknown as ISalesDocumentViewService,
    );
  });

  it('maps query filters onto the service call and dates onto Date objects', async () => {
    salesDocumentView.listSalesDocuments.mockResolvedValue({
      items: [],
      nextCursor: { invoice: null, fiscal: null },
    });

    await controller.listSalesDocuments({
      kind: 'invoice',
      status: 'issued',
      connectionId: 'conn-1',
      issuedFrom: '2026-01-01T00:00:00.000Z',
      issuedTo: '2026-01-31T00:00:00.000Z',
      taxId: 'with',
      search: 'ol_order_1',
      limit: 10,
    });

    expect(salesDocumentView.listSalesDocuments).toHaveBeenCalledWith(
      {
        kind: 'invoice',
        status: 'issued',
        connectionId: 'conn-1',
        issuedFrom: new Date('2026-01-01T00:00:00.000Z'),
        issuedTo: new Date('2026-01-31T00:00:00.000Z'),
        taxId: 'with',
        search: 'ol_order_1',
      },
      { limit: 10, cursor: undefined },
    );
  });

  it('reports nextCursor as a bare null only when BOTH sources are exhausted', async () => {
    salesDocumentView.listSalesDocuments.mockResolvedValue({
      items: [],
      nextCursor: { invoice: null, fiscal: null },
    });

    const page = await controller.listSalesDocuments({ limit: 20 });

    expect(page.nextCursor).toBeNull();
  });

  it('encodes a non-exhausted cursor into an opaque string a later call can decode back', async () => {
    const cursorOut = {
      invoice: { createdAt: new Date('2026-01-05T00:00:00.000Z'), id: 'inv-5' },
      fiscal: null,
    };
    salesDocumentView.listSalesDocuments.mockResolvedValue({ items: [], nextCursor: cursorOut });

    const page = await controller.listSalesDocuments({ limit: 20 });

    expect(page.nextCursor).not.toBeNull();
    expect(decodeSalesDocumentListCursor(page.nextCursor!)).toEqual(cursorOut);
  });

  it('decodes an incoming cursor query param before calling the service', async () => {
    const incoming = { invoice: { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'a' }, fiscal: null };
    salesDocumentView.listSalesDocuments.mockResolvedValue({
      items: [],
      nextCursor: { invoice: null, fiscal: null },
    });

    await controller.listSalesDocuments({
      limit: 20,
      cursor: encodeSalesDocumentListCursor(incoming),
    });

    expect(salesDocumentView.listSalesDocuments).toHaveBeenCalledWith(
      expect.any(Object),
      { limit: 20, cursor: incoming },
    );
  });

  it('projects each item through the shared per-kind document DTO mapping', async () => {
    salesDocumentView.listSalesDocuments.mockResolvedValue({
      items: [
        {
          orderId: 'ol_order_1',
          connectionId: 'conn-1',
          document: invoiceDocument(),
          amount: { value: 100, currency: 'PLN' },
          otherRecordCount: 0,
        },
      ],
      nextCursor: { invoice: null, fiscal: null },
    });

    const page = await controller.listSalesDocuments({ limit: 20 });

    expect(page.items).toEqual([
      {
        orderId: 'ol_order_1',
        connectionId: 'conn-1',
        document: invoiceDocument(),
        amount: { value: 100, currency: 'PLN' },
        otherRecordCount: 0,
      },
    ]);
  });
});
