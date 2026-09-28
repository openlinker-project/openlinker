/**
 * Bench documents controller (#2418, `W3b-5`; label-print stamp moved here #3340)
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { Reflector } from '@nestjs/core';

import type { FulfillmentWorkView, IFulfillmentVerificationService } from '@openlinker/core/fulfillment';
import type { IInvoiceService } from '@openlinker/core/invoicing';
import type { IIntegrationsService } from '@openlinker/core/integrations';
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

    controller = new BenchDocumentsController(
      documents,
      parcels,
      invoices,
      integrations,
      verification,
      labelDocuments
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
