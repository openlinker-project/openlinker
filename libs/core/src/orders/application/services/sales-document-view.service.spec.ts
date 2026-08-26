/**
 * SalesDocumentViewService - unit spec (#2516, ADR-065)
 *
 * @module libs/core/src/orders/application/services
 */
import { Test } from '@nestjs/testing';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { INVOICE_SERVICE_TOKEN } from '@openlinker/core/invoicing';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import { FISCAL_REGISTRATION_SERVICE_TOKEN } from '@openlinker/core/fiscalization';
import { FiscalRegistrationRecord } from '@openlinker/core/fiscalization';
import { SALES_DOCUMENT_RULES_SERVICE_TOKEN } from '@openlinker/core/sales-documents';

import { OrderRecord } from '../../domain/entities/order-record.entity';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import { SalesDocumentViewService } from './sales-document-view.service';

const NOW = new Date('2026-08-01T10:00:00.000Z');

function orderRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const base = new OrderRecord(
    'ol_order_1',
    null,
    'conn-source',
    null,
    { shippingAddress: { country: 'PL' } },
    [],
    'ready',
    NOW,
    NOW,
    [],
  );
  return Object.assign(Object.create(OrderRecord.prototype) as OrderRecord, base, {
    totalAmount: 123,
    currency: 'PLN',
    taxTreatment: 'inclusive',
    ...overrides,
  });
}

function invoiceRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const base = new InvoiceRecord(
    'inv-1',
    'conn-invoicing',
    'ol_order_1',
    'ksef',
    'VAT',
    'issued',
    'prov-1',
    'FA/2026/08/0144',
    'submitted',
    'ref-1',
    null,
    null,
    new Date('2026-08-01T09:00:00.000Z'),
    null,
    new Date('2026-08-01T08:00:00.000Z'),
    new Date('2026-08-01T09:00:00.000Z'),
  );
  return Object.assign(Object.create(InvoiceRecord.prototype) as InvoiceRecord, base, overrides);
}

function fiscalRecord(overrides: Partial<FiscalRegistrationRecord> = {}): FiscalRegistrationRecord {
  const base = new FiscalRegistrationRecord(
    'fis-1',
    'conn-fiscal',
    'ol_order_1',
    'eparagony',
    'fiscal:conn-fiscal:ol_order_1',
    'registered',
    'prov-ref',
    'DOC/1',
    'signer',
    new Date('2026-08-01T09:30:00.000Z'),
    null,
    [],
    null,
    null,
    null,
    null,
    new Date('2026-08-01T08:30:00.000Z'),
    new Date('2026-08-01T09:30:00.000Z'),
  );
  return Object.assign(
    Object.create(FiscalRegistrationRecord.prototype) as FiscalRegistrationRecord,
    base,
    overrides,
  );
}

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-invoicing',
    platformType: 'ksef',
    name: 'KSeF',
    status: 'active',
    config: { salesDocument: { documentKind: 'invoice' } },
    credentialsRef: null,
    enabledCapabilities: ['Invoicing'],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Connection;
}

describe('SalesDocumentViewService', () => {
  let service: SalesDocumentViewService;
  let orderRecords: { findByIds: jest.Mock };
  let invoices: { listInvoicesForOrders: jest.Mock };
  let fiscalRegistrations: { getByOrderIds: jest.Mock };
  let connections: { list: jest.Mock };
  let rules: { resolveRoutingBatch: jest.Mock };

  beforeEach(async () => {
    orderRecords = { findByIds: jest.fn().mockResolvedValue([]) };
    invoices = { listInvoicesForOrders: jest.fn().mockResolvedValue([]) };
    fiscalRegistrations = { getByOrderIds: jest.fn().mockResolvedValue([]) };
    connections = { list: jest.fn().mockResolvedValue([]) };
    rules = { resolveRoutingBatch: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalesDocumentViewService,
        { provide: ORDER_RECORD_REPOSITORY_TOKEN, useValue: orderRecords },
        { provide: INVOICE_SERVICE_TOKEN, useValue: invoices },
        { provide: FISCAL_REGISTRATION_SERVICE_TOKEN, useValue: fiscalRegistrations },
        { provide: CONNECTION_PORT_TOKEN, useValue: connections },
        { provide: SALES_DOCUMENT_RULES_SERVICE_TOKEN, useValue: rules },
      ],
    }).compile();

    service = moduleRef.get(SalesDocumentViewService);
  });

  it('should return an empty map without reading anything when given no ids', async () => {
    await expect(service.getForOrders([])).resolves.toEqual(new Map());
    expect(orderRecords.findByIds).not.toHaveBeenCalled();
    expect(invoices.listInvoicesForOrders).not.toHaveBeenCalled();
    expect(fiscalRegistrations.getByOrderIds).not.toHaveBeenCalled();
  });

  it('should project an invoice on both of its axes', async () => {
    orderRecords.findByIds.mockResolvedValue([orderRecord()]);
    invoices.listInvoicesForOrders.mockResolvedValue([invoiceRecord()]);

    const view = (await service.getForOrders(['ol_order_1'])).get('ol_order_1');

    expect(view?.documentKind).toBe('invoice');
    expect(view?.document).toEqual({
      kind: 'invoice',
      documentType: 'VAT',
      status: 'issued',
      failureMode: null,
      failureCode: null,
      failureReason: null,
      regulatoryStatus: 'submitted',
      clearanceReference: 'ref-1',
      identity: {
        recordId: 'inv-1',
        connectionId: 'conn-invoicing',
        providerType: 'ksef',
        documentNumber: 'FA/2026/08/0144',
        createdAt: '2026-08-01T08:00:00.000Z',
        completedAt: '2026-08-01T09:00:00.000Z',
        inFlightUntil: null,
      },
    });
    // The rule engine is never consulted for an order that already has a
    // document: the record's own kind IS the answer.
    expect(rules.resolveRoutingBatch).not.toHaveBeenCalled();
  });

  it('should project a fiscal receipt with no authority axis at all', async () => {
    orderRecords.findByIds.mockResolvedValue([orderRecord()]);
    fiscalRegistrations.getByOrderIds.mockResolvedValue([fiscalRecord()]);

    const view = (await service.getForOrders(['ol_order_1'])).get('ol_order_1');

    expect(view?.documentKind).toBe('fiscal-receipt');
    expect(view?.document).toEqual({
      kind: 'fiscal-receipt',
      status: 'registered',
      failureMode: null,
      failureReason: null,
      artefactCount: 0,
      identity: {
        recordId: 'fis-1',
        connectionId: 'conn-fiscal',
        providerType: 'eparagony',
        documentNumber: 'DOC/1',
        createdAt: '2026-08-01T08:30:00.000Z',
        completedAt: '2026-08-01T09:30:00.000Z',
        inFlightUntil: null,
      },
    });
    expect(view?.document && 'regulatoryStatus' in view.document).toBe(false);
  });

  it('should return the persisted block reasons verbatim', async () => {
    orderRecords.findByIds.mockResolvedValue([
      orderRecord({
        salesDocumentBlockReason: 'unresolved-routing',
        salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
        salesDocumentBlockDetail: '2 invoicing connections, none marked primary',
      }),
    ]);

    const view = (await service.getForOrders(['ol_order_1'])).get('ol_order_1');

    expect(view?.blockReason).toBe('unresolved-routing');
    expect(view?.unresolvedReason).toBe('ambiguous-connection-no-primary');
    expect(view?.blockDetail).toBe('2 invoicing connections, none marked primary');
  });

  it('should keep an order with no document in the map, with the kind routing resolves', async () => {
    orderRecords.findByIds.mockResolvedValue([orderRecord()]);
    connections.list.mockResolvedValue([connection()]);
    rules.resolveRoutingBatch.mockResolvedValue([
      { kind: 'unresolved', reason: 'no-configuration-for-country' },
    ]);

    const views = await service.getForOrders(['ol_order_1']);

    expect(views.has('ol_order_1')).toBe(true);
    expect(views.get('ol_order_1')?.document).toBeNull();
    expect(views.get('ol_order_1')?.documentKind).toBe('invoice');
  });

  it('should report a null kind when routing has not decided', async () => {
    orderRecords.findByIds.mockResolvedValue([orderRecord()]);
    rules.resolveRoutingBatch.mockResolvedValue([
      { kind: 'unresolved', reason: 'no-configuration-for-country' },
    ]);

    const view = (await service.getForOrders(['ol_order_1'])).get('ol_order_1');

    expect(view?.documentKind).toBeNull();
    expect(view?.document).toBeNull();
  });

  it('should report a record held on another connection instead of hiding it', async () => {
    orderRecords.findByIds.mockResolvedValue([orderRecord()]);
    invoices.listInvoicesForOrders.mockResolvedValue([
      invoiceRecord(),
      invoiceRecord({
        id: 'inv-older',
        connectionId: 'conn-other',
        createdAt: new Date('2026-07-01T08:00:00.000Z'),
      }),
    ]);

    const view = (await service.getForOrders(['ol_order_1'])).get('ol_order_1');

    expect(view?.document?.identity.recordId).toBe('inv-1');
    expect(view?.otherRecords).toEqual([
      {
        recordId: 'inv-older',
        connectionId: 'conn-other',
        kind: 'invoice',
        blocksFurtherIssuance: true,
      },
    ]);
  });

  it('should treat an older record on the winning connection as that document history, not a second document', async () => {
    orderRecords.findByIds.mockResolvedValue([orderRecord()]);
    invoices.listInvoicesForOrders.mockResolvedValue([
      invoiceRecord(),
      invoiceRecord({ id: 'inv-older', createdAt: new Date('2026-07-01T08:00:00.000Z') }),
    ]);

    const view = (await service.getForOrders(['ol_order_1'])).get('ol_order_1');

    expect(view?.otherRecords).toEqual([]);
  });

  it('should omit an id with no order record at all', async () => {
    orderRecords.findByIds.mockResolvedValue([]);

    await expect(service.getForOrders(['ol_order_missing'])).resolves.toEqual(new Map());
  });

  it('should not grow its query count with the number of ids', async () => {
    const ids = Array.from({ length: 50 }, (_, index) => `ol_order_${index}`);
    orderRecords.findByIds.mockResolvedValue(
      ids.map((id) => orderRecord({ internalOrderId: id })),
    );
    connections.list.mockResolvedValue([connection()]);
    rules.resolveRoutingBatch.mockResolvedValue(
      ids.map(() => ({ kind: 'unresolved', reason: 'no-configuration-for-country' })),
    );

    const views = await service.getForOrders(ids);

    expect(views.size).toBe(50);
    // One read per store for the whole page - the `getEarliestOrderDateByConnection`
    // (#2083) shape. A per-row loop would call each of these 50 times.
    expect(orderRecords.findByIds).toHaveBeenCalledTimes(1);
    expect(invoices.listInvoicesForOrders).toHaveBeenCalledTimes(1);
    expect(fiscalRegistrations.getByOrderIds).toHaveBeenCalledTimes(1);
    expect(connections.list).toHaveBeenCalledTimes(1);
    expect(rules.resolveRoutingBatch).toHaveBeenCalledTimes(1);
  });

  it('should collapse duplicate ids before reading', async () => {
    orderRecords.findByIds.mockResolvedValue([orderRecord()]);

    await service.getForOrders(['ol_order_1', 'ol_order_1']);

    expect(orderRecords.findByIds).toHaveBeenCalledWith(['ol_order_1']);
  });
});
