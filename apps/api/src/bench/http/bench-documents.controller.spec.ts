/**
 * Bench documents controller (#2418, `W3b-5`; label-print stamp moved here #3340)
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { Reflector } from '@nestjs/core';

import type { FulfillmentWorkView, IFulfillmentVerificationService } from '@openlinker/core/fulfillment';
import type { IInvoiceService } from '@openlinker/core/invoicing';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ISalesDocumentViewService } from '@openlinker/core/orders';
import type { IShipmentLabelService, LabelDocument } from '@openlinker/core/shipping';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { IBenchDocumentsService } from '../application/interfaces/bench-documents.service.interface';
import type { IBenchParcelService } from '../application/interfaces/bench-parcel.service.interface';
import type { BenchDocumentsView } from '../application/types/bench-parcel.types';
import { BenchDocumentsController } from './bench-documents.controller';

function work(overrides: Partial<FulfillmentWorkView> = {}): FulfillmentWorkView {
  return {
    id: 'work-1',
    orderId: 'ol_order_1',
    locationId: null,
    deliveryMethod: null,
    assignedConnectionId: null,
    assignedToUserId: null,
    selfServeEligible: true,
    status: 'open',
    requestStatus: 'unsubmitted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
    expeditedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    lines: [],
    activeHolds: [],
    supportedActions: [],
    version: 1,
    ...overrides,
  } as FulfillmentWorkView;
}

function documentsView(overrides: Partial<BenchDocumentsView> = {}): BenchDocumentsView {
  return {
    workId: 'work-1',
    invoice: { state: 'missing', blockReason: null, unresolvedReason: null },
    document: null,
    noDocument: { documentKind: null, blockReason: null, unresolvedReason: null },
    label: { state: 'ready', shipmentId: 'ol_shipment_1', carrier: 'dpd', trackingNumber: '123' },
    ...overrides,
  } as BenchDocumentsView;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    // A readable stream really can yield either, so both arms are handled
    // rather than asserting one away - the cast this replaces did not
    // type-check, because a string and a Uint8Array do not overlap.
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks);
}

function makeRes(): { res: Response; setHeader: jest.Mock } {
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  return { res, setHeader };
}

describe('BenchDocumentsController — GET work/:workId/documents/label (#3340)', () => {
  let documents: jest.Mocked<IBenchDocumentsService>;
  let parcels: jest.Mocked<IBenchParcelService>;
  let invoices: jest.Mocked<IInvoiceService>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let verification: jest.Mocked<IFulfillmentVerificationService>;
  let labelDocuments: jest.Mocked<IShipmentLabelService>;
  let salesDocuments: jest.Mocked<Pick<ISalesDocumentViewService, 'getReceiptHandoverArtefact'>>;
  let controller: BenchDocumentsController;

  const labelDoc: LabelDocument = {
    contentType: 'application/pdf',
    body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  };

  beforeEach(() => {
    documents = {
      getDocuments: jest.fn().mockResolvedValue(documentsView()),
      listUnlabelled: jest.fn(),
    };
    parcels = {
      getParcel: jest.fn(),
      getWorkForDocuments: jest.fn().mockResolvedValue(work()),
      verifyUnit: jest.fn(),
      reopenParcel: jest.fn(),
      undoLastScan: jest.fn(),
      listActivity: jest.fn(),
      claimParcel: jest.fn(),
      completeParcel: jest.fn(),
      undoCompletion: jest.fn(),
    };
    invoices = {} as jest.Mocked<IInvoiceService>;
    integrations = {} as jest.Mocked<IIntegrationsService>;
    verification = {
      getState: jest.fn(),
      verifyUnit: jest.fn(),
      reopenParcel: jest.fn(),
      voidLastVerification: jest.fn(),
      listVerifications: jest.fn(),
      markInvoicePrinted: jest.fn(),
      markLabelPrinted: jest.fn().mockResolvedValue(true),
      complete: jest.fn(),
      undoCompletion: jest.fn(),
    };
    labelDocuments = { fetchLabel: jest.fn().mockResolvedValue(labelDoc) };
    salesDocuments = { getReceiptHandoverArtefact: jest.fn().mockResolvedValue(null) };

    controller = new BenchDocumentsController(
      documents,
      parcels,
      invoices,
      integrations,
      verification,
      labelDocuments,
      salesDocuments as unknown as ISalesDocumentViewService
    );
  });

  it('should admit exactly admin, operator and packer', () => {
    const roles = new Reflector().get<string[]>(ROLES_KEY, BenchDocumentsController.prototype.downloadLabel);
    expect(roles).toEqual(['admin', 'operator', 'packer']);
  });

  it('should resolve the label through the SAME projection the documents read uses, never a caller-supplied shipment id', async () => {
    const { res } = makeRes();

    await controller.downloadLabel('work-1', res);

    expect(parcels.getWorkForDocuments).toHaveBeenCalledWith('work-1');
    expect(documents.getDocuments).toHaveBeenCalledWith(work(), false);
    expect(labelDocuments.fetchLabel).toHaveBeenCalledWith('ol_shipment_1');
  });

  it('should serve the label bytes with the provider content type', async () => {
    const { res, setHeader } = makeRes();

    const streamable = await controller.downloadLabel('work-1', res);

    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    const bytes = await readStream(streamable.getStream());
    expect(bytes).toEqual(Buffer.from(labelDoc.body));
  });

  it('should stamp FulfillmentWork.labelPrintedAt with the resolved work id', async () => {
    const { res } = makeRes();

    await controller.downloadLabel('work-1', res);

    expect(verification.markLabelPrinted).toHaveBeenCalledWith('work-1', expect.any(Date));
  });

  it('should still serve the bytes when the print stamp throws (best-effort)', async () => {
    verification.markLabelPrinted.mockRejectedValue(new Error('db unavailable'));
    const { res } = makeRes();

    const streamable = await controller.downloadLabel('work-1', res);

    const bytes = await readStream(streamable.getStream());
    expect(bytes).toEqual(Buffer.from(labelDoc.body));
  });

  it('should 404 when the parcel has no ready label — matching the documents read', async () => {
    documents.getDocuments.mockResolvedValue(documentsView({ label: { state: 'none' } }));
    const { res } = makeRes();

    await expect(controller.downloadLabel('work-1', res)).rejects.toBeInstanceOf(NotFoundException);
    expect(labelDocuments.fetchLabel).not.toHaveBeenCalled();
    expect(verification.markLabelPrinted).not.toHaveBeenCalled();
  });

  it('should answer a neutral 409, never the provider’s own words, when the fetch fails', async () => {
    labelDocuments.fetchLabel.mockRejectedValue(new Error('carrier said: address invalid'));
    const { res } = makeRes();

    const err = await controller.downloadLabel('work-1', res).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).not.toContain('address invalid');
    expect(verification.markLabelPrinted).not.toHaveBeenCalled();
  });
});

describe('BenchDocumentsController — receipt (#3646)', () => {
  let documents: jest.Mocked<IBenchDocumentsService>;
  let parcels: jest.Mocked<Pick<IBenchParcelService, 'getWorkForDocuments'>>;
  let salesDocuments: jest.Mocked<Pick<ISalesDocumentViewService, 'getReceiptHandoverArtefact'>>;
  let controller: BenchDocumentsController;

  beforeEach(() => {
    documents = {
      getDocuments: jest.fn().mockResolvedValue(documentsView()),
      listUnlabelled: jest.fn(),
    };
    parcels = { getWorkForDocuments: jest.fn().mockResolvedValue(work()) };
    salesDocuments = { getReceiptHandoverArtefact: jest.fn().mockResolvedValue(null) };
    controller = new BenchDocumentsController(
      documents,
      parcels as unknown as IBenchParcelService,
      {} as IInvoiceService,
      {} as IIntegrationsService,
      {} as IFulfillmentVerificationService,
      {} as IShipmentLabelService,
      salesDocuments as unknown as ISalesDocumentViewService
    );
  });

  it('should admit exactly admin, operator and packer on the receipt route', () => {
    const roles = new Reflector().get<string[]>(
      ROLES_KEY,
      BenchDocumentsController.prototype.downloadReceipt
    );
    expect(roles).toEqual(['admin', 'operator', 'packer']);
  });

  it('should take no registration id, so it cannot be walked to another receipt', () => {
    // The route's only input is the work; the order comes from the work.
    expect(BenchDocumentsController.prototype.downloadReceipt.length).toBe(2);
  });

  it("should read the receipt of the WORK's own order", async () => {
    const { res } = makeRes();
    parcels.getWorkForDocuments.mockResolvedValue(work({ orderId: 'ol_order_42' }));
    salesDocuments.getReceiptHandoverArtefact.mockResolvedValue({
      medium: 'link',
      disposition: 'send',
      content: 'https://receipts.example.test/r/16240',
      contentType: null,
      label: 'Receipt',
    });

    await controller.downloadReceipt('work-1', res);

    expect(salesDocuments.getReceiptHandoverArtefact).toHaveBeenCalledWith('ol_order_42');
  });

  it('should answer a link artefact with JSON, never a redirect', async () => {
    const { res, setHeader } = makeRes();
    salesDocuments.getReceiptHandoverArtefact.mockResolvedValue({
      medium: 'link',
      disposition: 'send',
      content: 'https://receipts.example.test/r/16240',
      contentType: null,
      label: 'Receipt',
    });

    await expect(controller.downloadReceipt('work-1', res)).resolves.toEqual({
      url: 'https://receipts.example.test/r/16240',
    });
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('should stream a document artefact decoded from base64', async () => {
    const { res, setHeader } = makeRes();
    salesDocuments.getReceiptHandoverArtefact.mockResolvedValue({
      medium: 'document',
      disposition: 'print',
      content: Buffer.from('%PDF').toString('base64'),
      contentType: 'application/pdf',
      label: 'Receipt',
    });

    const result = await controller.downloadReceipt('work-1', res);

    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    const body = await readStream((result as { getStream(): NodeJS.ReadableStream }).getStream());
    expect(body.toString()).toBe('%PDF');
  });

  it.each(['application/pdf', 'image/png', 'image/jpeg', 'Application/PDF; charset=binary'])(
    'should open the receipt inline when its content type is %s',
    async (contentType) => {
      const { res, setHeader } = makeRes();
      salesDocuments.getReceiptHandoverArtefact.mockResolvedValue({
        medium: 'document',
        disposition: 'print',
        content: Buffer.from('bytes').toString('base64'),
        contentType,
        label: 'Receipt',
      });

      await controller.downloadReceipt('work-1', res);

      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="receipt-ol_order_1"'
      );
    }
  );

  it.each(['text/html', 'image/svg+xml', 'application/xhtml+xml', null])(
    'should serve the receipt as a download when its content type is %s',
    async (contentType) => {
      const { res, setHeader } = makeRes();
      salesDocuments.getReceiptHandoverArtefact.mockResolvedValue({
        medium: 'document',
        disposition: 'print',
        content: Buffer.from('<script>alert(1)</script>').toString('base64'),
        contentType,
        label: 'Receipt',
      });

      await controller.downloadReceipt('work-1', res);

      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="receipt-ol_order_1"'
      );
    }
  );

  it('should 404 when the order has no receipt to hand over', async () => {
    const { res } = makeRes();

    await expect(controller.downloadReceipt('work-1', res)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('should map a receipt document field by field, with no artefact content', async () => {
    documents.getDocuments.mockResolvedValue(
      documentsView({
        document: {
          kind: 'fiscal-receipt',
          recordId: 'fis-1',
          connectionId: 'conn-ep',
          platformType: 'eparagony',
          status: 'registered',
          failureMode: null,
          documentReference: '16240',
          completedAt: '2026-09-30T09:00:00.000Z',
          artefacts: [{ medium: 'link', disposition: 'send', label: 'Receipt', contentType: null }],
        },
        noDocument: null,
      })
    );

    const dto = await controller.getDocuments('work-1');

    expect(dto.document).toEqual({
      kind: 'fiscal-receipt',
      recordId: 'fis-1',
      connectionId: 'conn-ep',
      platformType: 'eparagony',
      status: 'registered',
      failureMode: null,
      documentNumber: '16240',
      completedAt: '2026-09-30T09:00:00.000Z',
      printable: false,
      artefacts: [{ medium: 'link', disposition: 'send', label: 'Receipt', contentType: null }],
    });
    expect(Object.keys(dto.document?.artefacts?.[0] ?? {}).sort()).toEqual([
      'contentType',
      'disposition',
      'label',
      'medium',
    ]);
    // A document exists, so no reason left over from before it is reported.
    expect(dto.blockReason).toBeNull();
    expect(dto.documentKind).toBeNull();
  });

  it('should report the block reason only when there is no document', async () => {
    documents.getDocuments.mockResolvedValue(
      documentsView({
        document: null,
        noDocument: {
          documentKind: 'invoice',
          blockReason: 'trigger-model-manual',
          unresolvedReason: null,
        },
      })
    );

    const dto = await controller.getDocuments('work-1');

    expect(dto.document).toBeNull();
    expect(dto.documentKind).toBe('invoice');
    expect(dto.blockReason).toBe('trigger-model-manual');
  });
});

describe('BenchDocumentsController — invoice Content-Disposition (#3646 review)', () => {
  let getRegulatoryDocument: jest.Mock;
  let controller: BenchDocumentsController;

  beforeEach(() => {
    getRegulatoryDocument = jest.fn();
    const invoices = {
      getLatestIssuedInvoiceForOrder: jest.fn().mockResolvedValue({
        id: 'inv-1',
        connectionId: 'conn-invoicing',
        regulatoryStatus: 'accepted',
      }),
    } as unknown as IInvoiceService;
    const integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({ getRegulatoryDocument }),
    } as unknown as IIntegrationsService;
    controller = new BenchDocumentsController(
      {} as IBenchDocumentsService,
      {
        getWorkForDocuments: jest.fn().mockResolvedValue(work()),
      } as unknown as IBenchParcelService,
      invoices,
      integrations,
      { markInvoicePrinted: jest.fn() } as unknown as IFulfillmentVerificationService,
      {} as IShipmentLabelService,
      {} as ISalesDocumentViewService
    );
  });

  it('should open the invoice inline when the provider renders a PDF', async () => {
    const { res, setHeader } = makeRes();
    getRegulatoryDocument.mockResolvedValue({
      contentType: 'application/pdf',
      content: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });

    await controller.downloadInvoice('work-1', res);

    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'inline; filename="invoice-inv-1"'
    );
  });

  it('should serve the invoice as a download when the provider renders HTML', async () => {
    const { res, setHeader } = makeRes();
    getRegulatoryDocument.mockResolvedValue({
      contentType: 'text/html; charset=utf-8',
      content: new TextEncoder().encode('<html></html>'),
    });

    await controller.downloadInvoice('work-1', res);

    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="invoice-inv-1"'
    );
  });
});
