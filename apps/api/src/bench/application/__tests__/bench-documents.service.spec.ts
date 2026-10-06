/**
 * Bench Documents Service - sales-document slot (#3646)
 *
 * The bench names the order's sales document from the SAME per-order
 * projection the `/orders` row and the order panel read, in every status and of
 * either kind, and reports the persisted block reason only when no document
 * exists at all.
 *
 * @module apps/api/src/bench/application/__tests__
 */
import type { FulfillmentWorkView, IFulfillmentWorklistService } from '@openlinker/core/fulfillment';
import type { IInvoiceService } from '@openlinker/core/invoicing';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IOrderRecordService, ISalesDocumentViewService } from '@openlinker/core/orders';
import type {
  SalesDocumentIdentity,
  SalesDocumentRecordView,
  SalesDocumentView,
} from '@openlinker/core/sales-documents';
import type { IShipmentQueryService } from '@openlinker/core/shipping';

import { BenchDocumentsService } from '../services/bench-documents.service';
import type { BenchExecutorResolver } from '../services/bench-executor.resolver';

const ORDER_ID = 'ol_order_1';

const identity: SalesDocumentIdentity = {
  recordId: 'rec-1',
  connectionId: 'conn-1',
  providerType: 'eparagony',
  documentNumber: '16240',
  createdAt: '2026-09-30T08:00:00.000Z',
  completedAt: '2026-09-30T08:01:00.000Z',
  inFlightUntil: null,
};

function view(overrides: Partial<SalesDocumentView> = {}): SalesDocumentView {
  return {
    orderId: ORDER_ID,
    documentKind: null,
    document: null,
    blockReason: null,
    unresolvedReason: null,
    blockDetail: null,
    otherRecords: [],
    matchedRule: null,
    ...overrides,
  };
}

function receipt(overrides: Partial<SalesDocumentRecordView> = {}): SalesDocumentRecordView {
  return {
    kind: 'fiscal-receipt',
    status: 'registered',
    failureMode: null,
    failureReason: null,
    artefactCount: 1,
    artefacts: [{ medium: 'link', disposition: 'send', label: 'Receipt', contentType: null }],
    identity,
    ...overrides,
  } as SalesDocumentRecordView;
}

function invoice(overrides: Partial<SalesDocumentRecordView> = {}): SalesDocumentRecordView {
  return {
    kind: 'invoice',
    documentType: 'invoice',
    status: 'issued',
    failureMode: null,
    failureCode: null,
    failureReason: null,
    regulatoryStatus: 'accepted',
    clearanceReference: null,
    identity: { ...identity, providerType: 'ksef', documentNumber: 'FV/1' },
    ...overrides,
  } as SalesDocumentRecordView;
}

describe('BenchDocumentsService - the sales-document slot (#3646)', () => {
  let salesDocuments: { getForOrders: jest.Mock };
  let integrations: { getAdapter: jest.Mock; getCapabilityAdapter: jest.Mock };
  let service: BenchDocumentsService;
  const work = { id: 'work-1', orderId: ORDER_ID } as FulfillmentWorkView;

  beforeEach(() => {
    salesDocuments = { getForOrders: jest.fn().mockResolvedValue(new Map()) };
    integrations = {
      getAdapter: jest.fn().mockResolvedValue({ connection: { platformType: 'eparagony' } }),
      // Not a `RegulatoryDocumentReader`, so an issued invoice reads as not printable.
      getCapabilityAdapter: jest.fn().mockResolvedValue({}),
    };
    service = new BenchDocumentsService(
      {} as BenchExecutorResolver,
      {} as IFulfillmentWorklistService,
      { getLatestIssuedInvoiceForOrder: jest.fn().mockResolvedValue(null) } as unknown as IInvoiceService,
      integrations as unknown as IIntegrationsService,
      { findByIds: jest.fn().mockResolvedValue([]) } as unknown as IOrderRecordService,
      {
        findByFulfillmentWorkIds: jest.fn().mockResolvedValue(new Map()),
      } as unknown as IShipmentQueryService,
      salesDocuments as unknown as ISalesDocumentViewService
    );
  });

  const withView = (value: SalesDocumentView): void => {
    salesDocuments.getForOrders.mockResolvedValue(new Map([[ORDER_ID, value]]));
  };

  it('should name a registered receipt instead of reporting a missing invoice', async () => {
    withView(view({ documentKind: 'fiscal-receipt', document: receipt(), blockReason: 'trigger-model-manual' }));

    const result = await service.getDocuments(work, false);

    expect(result.document).toEqual({
      kind: 'fiscal-receipt',
      recordId: 'rec-1',
      connectionId: 'conn-1',
      platformType: 'eparagony',
      status: 'registered',
      failureMode: null,
      documentReference: '16240',
      completedAt: '2026-09-30T08:01:00.000Z',
      artefacts: [{ medium: 'link', disposition: 'send', label: 'Receipt', contentType: null }],
    });
    // The stale reason is not carried beside a document it would contradict.
    expect(result.noDocument).toBeNull();
  });

  it('should carry a receipt still being registered, not report it missing', async () => {
    withView(view({ document: receipt({ status: 'registering', artefacts: null, artefactCount: 0 }) }));

    const result = await service.getDocuments(work, false);

    expect(result.document).toMatchObject({ kind: 'fiscal-receipt', status: 'registering', artefacts: null });
  });

  it('should carry a failed receipt with its failure mode', async () => {
    withView(view({ document: receipt({ status: 'failed', failureMode: 'in-doubt', artefacts: null }) }));

    const result = await service.getDocuments(work, false);

    expect(result.document).toMatchObject({ status: 'failed', failureMode: 'in-doubt' });
  });

  it('should fall back to no platformType when the connection cannot be resolved', async () => {
    withView(view({ document: receipt() }));
    integrations.getAdapter.mockRejectedValue(new Error('disabled'));

    const result = await service.getDocuments(work, false);

    expect(result.document).toMatchObject({ kind: 'fiscal-receipt', platformType: null });
  });

  it('should carry an invoice in progress, never offering it for print', async () => {
    withView(view({ document: invoice({ status: 'issuing', regulatoryStatus: 'pending-submission' }) }));

    const result = await service.getDocuments(work, false);

    expect(result.document).toMatchObject({ kind: 'invoice', status: 'issuing', printable: false });
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should mark an issued invoice printable only when its provider can render it', async () => {
    withView(view({ document: invoice() }));
    integrations.getCapabilityAdapter.mockResolvedValue({ getRegulatoryDocument: jest.fn() });

    const result = await service.getDocuments(work, false);

    expect(result.document).toMatchObject({ kind: 'invoice', status: 'issued', printable: true });
  });

  it('should report the block reason only when the order has no document of any kind', async () => {
    withView(view({ documentKind: 'invoice', blockReason: 'trigger-model-manual' }));

    const result = await service.getDocuments(work, false);

    expect(result.document).toBeNull();
    expect(result.noDocument).toEqual({
      documentKind: 'invoice',
      blockReason: 'trigger-model-manual',
      unresolvedReason: null,
    });
  });

  it('should report no document and no reason for an order the projection does not know', async () => {
    const result = await service.getDocuments(work, false);

    expect(result.document).toBeNull();
    expect(result.noDocument).toEqual({ documentKind: null, blockReason: null, unresolvedReason: null });
  });
});
