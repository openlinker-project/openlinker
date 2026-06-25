/**
 * InvoicingController unit tests (#1119, #1224)
 *
 * Covers all endpoints: the issue/retry/list endpoints (orders + invoice service
 * seams mocked — NO repository ports); and the UPO download endpoint (repository
 * + integrations service mocked).
 *
 * @module apps/api/src/invoicing/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { IInvoiceService, InvoiceRecord } from '@openlinker/core/invoicing';
import {
  INVOICE_SERVICE_TOKEN,
  INVOICE_RECORD_REPOSITORY_TOKEN,
  InvoiceRecord as InvoiceRecordClass,
} from '@openlinker/core/invoicing';
import type {
  InvoiceRecordRepositoryPort,
  InvoicingPort,
  RegulatoryDocument,
} from '@openlinker/core/invoicing';
import type { IOrderRecordService } from '@openlinker/core/orders';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  OrderRecord,
  OrderSnapshotUnavailableError,
} from '@openlinker/core/orders';
import {
  AdapterNotFoundException,
  CapabilityNotSupportedException,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { InvoicingController } from './invoicing.controller';

const NOW = new Date('2026-06-23T10:00:00.000Z');

function makeInvoiceRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const base = {
    id: 'inv_1',
    connectionId: 'conn_1',
    orderId: 'ol_order_1',
    providerType: 'subiekt',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'FV/2026/1',
    providerInvoiceNumber: 'FV/2026/1',
    regulatoryStatus: 'not-applicable',
    clearanceReference: null,
    idempotencyKey: 'secret-key',
    pdfUrl: null,
    issuedAt: NOW,
    errorMessage: 'internal diagnostic',
    failureMode: null,
    failureCode: null,
    failureReason: null,
    leaseExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    isIssued: true,
    ...overrides,
  };
  // Mirror the real entity derivations (#1200) so the controller's gates can call
  // them: a live `issuing` lease is "in progress" (AC-5); `isReattemptableFailure`
  // is the batch-retry eligibility gate (#1245).
  return {
    ...base,
    isLeaseLive(now: Date): boolean {
      return (
        base.status === 'issuing' &&
        base.leaseExpiresAt !== null &&
        (base.leaseExpiresAt).getTime() > now.getTime()
      );
    },
    get isReattemptableFailure(): boolean {
      return base.status === 'failed' && base.failureMode === 'rejected';
    },
  } as InvoiceRecord;
}

function makeOrderRecord(snapshot?: Record<string, unknown>): OrderRecord {
  return new OrderRecord(
    'ol_order_1',
    'cust_1',
    'conn_src',
    null,
    snapshot ?? {
      id: 'ol_order_1',
      status: 'processing',
      items: [{ id: 'li_1', productId: 'p_1', quantity: 1, price: 100, name: 'Widget' }],
      totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN', taxTreatment: 'inclusive' },
      billingAddress: {
        firstName: 'Jan',
        lastName: 'Kowalski',
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '61-001',
        country: 'PL',
      },
      createdAt: '2026-06-20T08:00:00.000Z',
      updatedAt: '2026-06-21T09:30:00.000Z',
    },
    [],
    'ready',
    NOW,
    NOW,
  );
}

describe('InvoicingController', () => {
  let controller: InvoicingController;
  let invoiceService: jest.Mocked<IInvoiceService>;
  let orders: jest.Mocked<IOrderRecordService>;

  beforeEach(async () => {
    invoiceService = {
      issueInvoice: jest.fn(),
      getInvoice: jest.fn().mockResolvedValue(null),
      getInvoiceById: jest.fn().mockResolvedValue(null),
      listInvoices: jest.fn(),
    } as unknown as jest.Mocked<IInvoiceService>;
    orders = {
      getOrderRecord: jest.fn(),
    } as unknown as jest.Mocked<IOrderRecordService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [InvoicingController],
      providers: [
        { provide: INVOICE_SERVICE_TOKEN, useValue: invoiceService },
        { provide: ORDER_RECORD_SERVICE_TOKEN, useValue: orders },
      ],
    }).compile();

    controller = moduleRef.get(InvoicingController);
  });

  it('instantiates', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /invoices (issue / re-issue)', () => {
    const dto = { connectionId: 'conn_1', orderId: 'ol_order_1' };

    it('404 NotFound when the order record does not exist', async () => {
      orders.getOrderRecord.mockResolvedValue(null);
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
    });

    it('409 Conflict when an issued invoice already exists', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(makeInvoiceRecord({ status: 'issued' }));
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
    });

    it('409 Conflict when a pending invoice is in progress', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(makeInvoiceRecord({ status: 'pending' }));
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('409 Conflict when a row under a LIVE issuing lease is in progress (#1200)', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(
        makeInvoiceRecord({ status: 'issuing', leaseExpiresAt: new Date(Date.now() + 60_000) }),
      );
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(ConflictException);
      // An original attempt is mid-flight: never report a fresh 201, never re-issue.
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
    });

    it('does NOT 409 an EXPIRED issuing lease — it is re-claimable, so issuance proceeds (#1200)', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(
        makeInvoiceRecord({ status: 'issuing', leaseExpiresAt: new Date(Date.now() - 60_000) }),
      );
      invoiceService.issueInvoice.mockResolvedValue(makeInvoiceRecord({ status: 'issued' }));
      await controller.issueInvoice(dto);
      expect(invoiceService.issueInvoice).toHaveBeenCalled();
    });

    it('422 when the order record is not `ready` (snapshot unavailable)', async () => {
      const awaiting = new OrderRecord(
        'ol_order_1', null, 'conn_src', null, {}, [], 'awaiting_mapping', NOW, NOW,
      );
      orders.getOrderRecord.mockResolvedValue(awaiting);
      invoiceService.getInvoice.mockResolvedValue(null);
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('FIRST keyless issue (no prior row) passes idempotencyKey: undefined', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(null);
      invoiceService.issueInvoice.mockResolvedValue(makeInvoiceRecord());
      await controller.issueInvoice(dto);
      expect(invoiceService.issueInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'conn_1', orderId: 'ol_order_1' }),
      );
      const cmd = invoiceService.issueInvoice.mock.calls[0][0];
      expect(cmd.idempotencyKey).toBeUndefined();
    });

    it('keyless re-issue over a KEYED failed row reuses that row\'s own idempotencyKey', async () => {
      // The prior failed row carried a key; re-issue MUST target that key so the
      // service's findByIdempotencyKey retry path (R2/R3) reuses the same row
      // rather than starting a fresh attempt (which would duplicate the row +
      // make a second provider call).
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(
        makeInvoiceRecord({ status: 'failed', idempotencyKey: 'prior-key' }),
      );
      invoiceService.issueInvoice.mockResolvedValue(makeInvoiceRecord());
      await controller.issueInvoice(dto);
      const cmd = invoiceService.issueInvoice.mock.calls[0][0];
      expect(cmd.idempotencyKey).toBe('prior-key');
    });

    it('keyless re-issue over a KEYLESS failed row stays keyless (cannot dedup; R1)', async () => {
      // A first keyless issue persists the failed row with idempotencyKey=null.
      // There is no key to dedup against, so synthesizing one would only miss the
      // null-keyed row and duplicate it. The re-issue is a fresh keyless attempt.
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(
        makeInvoiceRecord({ status: 'failed', idempotencyKey: null }),
      );
      invoiceService.issueInvoice.mockResolvedValue(makeInvoiceRecord());
      await controller.issueInvoice(dto);
      const cmd = invoiceService.issueInvoice.mock.calls[0][0];
      expect(cmd.idempotencyKey).toBeUndefined();
    });

    it('caller-supplied idempotencyKey passes through to the mapper verbatim', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(null);
      invoiceService.issueInvoice.mockResolvedValue(makeInvoiceRecord());
      await controller.issueInvoice({ ...dto, idempotencyKey: 'caller-key' });
      const cmd = invoiceService.issueInvoice.mock.calls[0][0];
      expect(cmd.idempotencyKey).toBe('caller-key');
    });

    it('composes buyer + lines server-side from the order (client sends neither)', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(null);
      invoiceService.issueInvoice.mockResolvedValue(makeInvoiceRecord());
      await controller.issueInvoice({ ...dto, buyerTaxId: { scheme: 'pl-nip', value: '1234' } });
      const cmd = invoiceService.issueInvoice.mock.calls[0][0];
      expect(cmd.buyer.name).toBe('Jan Kowalski');
      expect(cmd.lines).toHaveLength(1);
      expect(cmd.currency).toBe('PLN');
      // B2B because a tax id was supplied.
      expect(cmd.buyer.type).toBe('company');
    });

    it('CapabilityNotSupportedException propagates UNCAUGHT (not converted to 422)', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(null);
      invoiceService.issueInvoice.mockRejectedValue(
        new CapabilityNotSupportedException('subiekt', 'Invoicing'),
      );
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(
        CapabilityNotSupportedException,
      );
    });

    it('AdapterNotFoundException -> 502 provider-unavailable message', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(null);
      invoiceService.issueInvoice.mockRejectedValue(new AdapterNotFoundException('subiekt'));
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('422 when the order snapshot has no usable buyer address', async () => {
      orders.getOrderRecord.mockResolvedValue(
        makeOrderRecord({
          id: 'ol_order_1',
          status: 'processing',
          items: [{ id: 'li_1', productId: 'p_1', quantity: 1, price: 100 }],
          totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN', taxTreatment: 'inclusive' },
          createdAt: '2026-06-20T08:00:00.000Z',
          updatedAt: '2026-06-21T09:30:00.000Z',
        }),
      );
      invoiceService.getInvoice.mockResolvedValue(null);
      // No address at all -> rehydration raises OrderSnapshotUnavailableError -> 422.
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('mapper InvalidBuyerProfileError (address present, no name) -> 400', async () => {
      orders.getOrderRecord.mockResolvedValue(
        makeOrderRecord({
          id: 'ol_order_1',
          status: 'processing',
          items: [{ id: 'li_1', productId: 'p_1', quantity: 1, price: 100 }],
          totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN', taxTreatment: 'inclusive' },
          // Address present (passes rehydration) but no company/person name -> the
          // command mapper throws InvalidBuyerProfileError -> 400.
          billingAddress: { address1: 'ul. X 1', city: 'Poznań', postalCode: '61-001', country: 'PL' },
          createdAt: '2026-06-20T08:00:00.000Z',
          updatedAt: '2026-06-21T09:30:00.000Z',
        }),
      );
      invoiceService.getInvoice.mockResolvedValue(null);
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('adapter rejection -> 422 GENERIC message; provider text NOT in the body', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(null);
      invoiceService.issueInvoice.mockRejectedValue(
        new Error('NIP 1234 rejected by KSeF: buyer Jan Kowalski invalid'),
      );
      const error = await controller.issueInvoice(dto).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      const message = (error as Error).message;
      expect(message).not.toContain('Kowalski');
      expect(message).not.toContain('KSeF');
      expect(message).toContain('correlationId');
    });

    it('OrderSnapshotUnavailableError from the service path -> 422 generic', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(null);
      invoiceService.issueInvoice.mockRejectedValue(
        new OrderSnapshotUnavailableError('ol_order_1', 'redacted'),
      );
      await expect(controller.issueInvoice(dto)).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('success -> 201 DTO with no errorMessage and no idempotencyKey', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(null);
      invoiceService.issueInvoice.mockResolvedValue(makeInvoiceRecord());
      const result = await controller.issueInvoice(dto);
      expect(result.id).toBe('inv_1');
      expect(result.status).toBe('issued');
      expect(result).not.toHaveProperty('errorMessage');
      expect(result).not.toHaveProperty('idempotencyKey');
      expect(result.issuedAt).toBe(NOW.toISOString());
      // W1: the failure-semantics fields are present (null on a success).
      expect(result.failureMode).toBeNull();
      expect(result.failureCode).toBeNull();
      expect(result.failureReason).toBeNull();
    });

    it('surfaces the W1 failure semantics (failureMode/failureCode/failureReason) on the DTO while still omitting errorMessage', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(
        makeInvoiceRecord({ status: 'failed' }),
      );
      invoiceService.issueInvoice.mockResolvedValue(
        makeInvoiceRecord({
          status: 'failed',
          failureMode: 'rejected',
          failureCode: 'buyer-tax-id-invalid',
          failureReason: 'The buyer tax identifier was rejected as invalid.',
          errorMessage: 'raw provider PII-tainted message',
        }),
      );

      // A prior `failed` row allows re-issue; the service returns a failed record
      // again, and the DTO must carry the neutral failure semantics for the FE.
      const result = await controller.issueInvoice(dto);

      expect(result.failureMode).toBe('rejected');
      expect(result.failureCode).toBe('buyer-tax-id-invalid');
      expect(result.failureReason).toBe('The buyer tax identifier was rejected as invalid.');
      // The PII-tainted internal diagnostic is NEVER exposed.
      expect(result).not.toHaveProperty('errorMessage');
    });
  });

  describe('GET /orders/:orderId/invoice', () => {
    // The invoicing connectionId is a REQUIRED query param (symmetric with POST):
    // it is the connection the invoice was issued on, NOT the order's
    // sourceConnectionId (a distinct marketplace capability).
    const invoicingConn = 'conn_inv';

    it('404 when the order record does not exist', async () => {
      orders.getOrderRecord.mockResolvedValue(null);
      await expect(
        controller.getInvoiceForOrder('ol_order_1', { connectionId: invoicingConn }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('looks the invoice up by the query connectionId (NOT the order sourceConnectionId)', async () => {
      // The order was ingested on `conn_src` but the invoice was issued on a
      // distinct invoicing connection — proves GET keys off the supplied param,
      // not the marketplace source connection.
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(makeInvoiceRecord());
      await controller.getInvoiceForOrder('ol_order_1', { connectionId: invoicingConn });
      expect(invoiceService.getInvoice).toHaveBeenCalledWith({
        orderId: 'ol_order_1',
        connectionId: invoicingConn,
      });
    });

    it('404 when getInvoice returns null', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(null);
      await expect(
        controller.getInvoiceForOrder('ol_order_1', { connectionId: invoicingConn }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('200 with DTO omitting errorMessage + idempotencyKey', async () => {
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.getInvoice.mockResolvedValue(makeInvoiceRecord());
      const result = await controller.getInvoiceForOrder('ol_order_1', {
        connectionId: invoicingConn,
      });
      expect(result).not.toHaveProperty('errorMessage');
      expect(result).not.toHaveProperty('idempotencyKey');
    });
  });

  describe('GET /invoices (list)', () => {
    it('maps status/connection/regulatory/date-range filters + pagination to listInvoices', async () => {
      invoiceService.listInvoices.mockResolvedValue({ items: [], total: 0 });
      await controller.listInvoices({
        status: 'issued',
        connectionId: 'conn_1',
        regulatoryStatus: 'cleared',
        issuedFrom: '2026-06-01T00:00:00.000Z',
        issuedTo: '2026-06-30T00:00:00.000Z',
        taxId: 'with',
        limit: 10,
        offset: 5,
      });
      expect(invoiceService.listInvoices).toHaveBeenCalledWith(
        {
          status: 'issued',
          connectionId: 'conn_1',
          regulatoryStatus: 'cleared',
          issuedFrom: new Date('2026-06-01T00:00:00.000Z'),
          issuedTo: new Date('2026-06-30T00:00:00.000Z'),
          taxId: 'with',
        },
        { limit: 10, offset: 5 },
      );
    });

    it('should forward taxId=without to listInvoices when taxId filter is provided (#1202)', async () => {
      invoiceService.listInvoices.mockResolvedValue({ items: [], total: 0 });
      await controller.listInvoices({ taxId: 'without', limit: 20, offset: 0 });
      const filter = invoiceService.listInvoices.mock.calls[0][0] as Record<string, unknown>;
      expect(filter.taxId).toBe('without');
    });

    it('returns { items, total, limit, offset } with DTOs omitting errorMessage + idempotencyKey', async () => {
      invoiceService.listInvoices.mockResolvedValue({ items: [makeInvoiceRecord()], total: 1 });
      const result = await controller.listInvoices({ limit: 20, offset: 0 });
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.items[0]).not.toHaveProperty('errorMessage');
      expect(result.items[0]).not.toHaveProperty('idempotencyKey');
    });

    it('defaults limit/offset when omitted', async () => {
      invoiceService.listInvoices.mockResolvedValue({ items: [], total: 0 });
      await controller.listInvoices({});
      expect(invoiceService.listInvoices).toHaveBeenCalledWith(expect.any(Object), {
        limit: 20,
        offset: 0,
      });
    });
  });

  describe('retryInvoices (#1245)', () => {
    it('should retry only failed+rejected records and reuse the record idempotencyKey', async () => {
      const eligible = makeInvoiceRecord({
        id: 'inv_fail',
        status: 'failed',
        failureMode: 'rejected',
        idempotencyKey: 'key-fail',
      });
      invoiceService.getInvoiceById.mockResolvedValue(eligible);
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.issueInvoice.mockResolvedValue(makeInvoiceRecord({ status: 'issued' }));

      const res = await controller.retryInvoices({ invoiceIds: ['inv_fail'] });

      expect(res.retried).toBe(1);
      expect(res.skipped).toBe(0);
      expect(res.results).toEqual([{ id: 'inv_fail', outcome: 'retried' }]);
      // Reuses the record's OWN key so the service resumes THAT row (R2/R3). The
      // command rebuilt from the order snapshot carries no scheme-tagged buyer tax
      // id (the projection doesn't persist it) → buyer.taxId is null.
      expect(invoiceService.issueInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'key-fail',
          buyer: expect.objectContaining({ taxId: null }),
        }),
      );
    });

    it('should skip an issued record server-side (never re-issues a done document)', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(makeInvoiceRecord({ status: 'issued' }));

      const res = await controller.retryInvoices({ invoiceIds: ['inv_1'] });

      expect(res.retried).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.results[0].outcome).toBe('skipped');
      expect(res.results[0].reason).toContain('status=issued');
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
    });

    it('should skip an in-doubt failed record (a document may exist — no blind retry)', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(
        makeInvoiceRecord({ status: 'failed', failureMode: 'in-doubt' }),
      );

      const res = await controller.retryInvoices({ invoiceIds: ['inv_1'] });

      expect(res.skipped).toBe(1);
      expect(res.results[0].reason).toContain('failureMode=in-doubt');
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
    });

    it('should skip issuing and pending records server-side', async () => {
      invoiceService.getInvoiceById
        .mockResolvedValueOnce(makeInvoiceRecord({ id: 'inv_issuing', status: 'issuing' }))
        .mockResolvedValueOnce(makeInvoiceRecord({ id: 'inv_pending', status: 'pending' }));

      const res = await controller.retryInvoices({ invoiceIds: ['inv_issuing', 'inv_pending'] });

      expect(res.retried).toBe(0);
      expect(res.skipped).toBe(2);
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
    });

    it('should skip an unknown id with a not-found reason', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(null);

      const res = await controller.retryInvoices({ invoiceIds: ['nope'] });

      expect(res.skipped).toBe(1);
      expect(res.results[0].reason).toContain('not found');
    });

    it('should capture a provider re-rejection as skipped without aborting the rest of the batch', async () => {
      const eligible = makeInvoiceRecord({ status: 'failed', failureMode: 'rejected' });
      const ok = makeInvoiceRecord({ id: 'inv_ok', status: 'failed', failureMode: 'rejected' });
      invoiceService.getInvoiceById
        .mockResolvedValueOnce(eligible)
        .mockResolvedValueOnce(ok);
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.issueInvoice
        .mockRejectedValueOnce(new Error('provider rejected again'))
        .mockResolvedValueOnce(makeInvoiceRecord({ status: 'issued' }));

      const res = await controller.retryInvoices({ invoiceIds: ['inv_1', 'inv_ok'] });

      expect(res.retried).toBe(1);
      expect(res.skipped).toBe(1);
      // The neutral reason never echoes the raw provider message.
      const failed = res.results.find((r) => r.id === 'inv_1');
      expect(failed?.outcome).toBe('skipped');
      expect(failed?.reason).not.toContain('provider rejected again');
      expect(failed?.reason).toContain('correlationId');
    });

    it('should de-duplicate repeated ids so an id is attempted at most once', async () => {
      const eligible = makeInvoiceRecord({ status: 'failed', failureMode: 'rejected' });
      invoiceService.getInvoiceById.mockResolvedValue(eligible);
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.issueInvoice.mockResolvedValue(makeInvoiceRecord({ status: 'issued' }));

      const res = await controller.retryInvoices({ invoiceIds: ['inv_1', 'inv_1'] });

      expect(res.results).toHaveLength(1);
      expect(invoiceService.issueInvoice).toHaveBeenCalledTimes(1);
    });

    it('should skip an eligible record whose backing order is no longer available', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(
        makeInvoiceRecord({ status: 'failed', failureMode: 'rejected' }),
      );
      orders.getOrderRecord.mockResolvedValue(null);

      const res = await controller.retryInvoices({ invoiceIds: ['inv_1'] });

      expect(res.skipped).toBe(1);
      expect(res.results[0].reason).toContain('order');
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
    });
  });

  // ---- UPO download endpoint tests (#1224) ----------------------------------------

  describe('GET /invoices/:invoiceId/upo', () => {
    let repository: jest.Mocked<InvoiceRecordRepositoryPort>;
    let integrationsMock: jest.Mocked<IIntegrationsService>;
    let upoController: InvoicingController;

    function clearedRecord(): InvoiceRecordClass {
      return new InvoiceRecordClass(
        'rec-inv-1',
        'conn-ksef-1',
        'ol_order_001',
        'ksef',
        'invoice',
        'issued',
        'SESSION:INVOICE',
        null,
        'accepted',
        '5265877635-20250826-0100001AF629-AF',
        null,
        null,
        new Date('2026-04-01T12:00:00Z'),
        null,
        new Date('2026-04-01T12:00:00Z'),
        new Date('2026-04-01T12:00:00Z'),
      );
    }

    function pendingRecord(): InvoiceRecordClass {
      const r = clearedRecord();
      return new InvoiceRecordClass(
        r.id,
        r.connectionId,
        r.orderId,
        r.providerType,
        r.documentType,
        'issued',
        r.providerInvoiceId,
        r.providerInvoiceNumber,
        'submitted',
        null,
        r.idempotencyKey,
        r.pdfUrl,
        r.issuedAt,
        r.errorMessage,
        r.createdAt,
        r.updatedAt,
      );
    }

    function mockResponse(): Response & {
      headers: Record<string, string>;
      body: Buffer | null;
    } {
      const headers: Record<string, string> = {};
      let body: Buffer | null = null;
      const res = {
        headers,
        get body(): Buffer | null {
          return body;
        },
        setHeader(name: string, value: string): void {
          headers[name] = value;
        },
        send(payload: Buffer): void {
          body = payload;
        },
      };
      return res as unknown as Response & { headers: Record<string, string>; body: Buffer | null };
    }

    beforeEach(async () => {
      const mockRepo: jest.Mocked<InvoiceRecordRepositoryPort> = {
        create: jest.fn(),
        findById: jest.fn(),
        findByOrderId: jest.fn(),
        findLatestByOrderId: jest.fn(),
        findByIdempotencyKey: jest.fn(),
        updateOutcome: jest.fn(),
      } as unknown as jest.Mocked<InvoiceRecordRepositoryPort>;

      const mockIntegrations = {
        getCapabilityAdapter: jest.fn(),
      } as unknown as jest.Mocked<IIntegrationsService>;

      const module: TestingModule = await Test.createTestingModule({
        controllers: [InvoicingController],
        providers: [
          { provide: INVOICE_SERVICE_TOKEN, useValue: invoiceService },
          { provide: ORDER_RECORD_SERVICE_TOKEN, useValue: orders },
          { provide: INVOICE_RECORD_REPOSITORY_TOKEN, useValue: mockRepo },
          { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: mockIntegrations },
        ],
      }).compile();

      upoController = module.get(InvoicingController);
      repository = module.get(INVOICE_RECORD_REPOSITORY_TOKEN);
      integrationsMock = module.get(INTEGRATIONS_SERVICE_TOKEN);
    });

    it('should stream the UPO bytes for a cleared invoice (200)', async () => {
      repository.findById.mockResolvedValue(clearedRecord());
      const document: RegulatoryDocument = {
        content: new Uint8Array([1, 2, 3]),
        contentType: 'application/xml',
      };
      const adapter: InvoicingPort = {
        issueInvoice: jest.fn(),
        getInvoice: jest.fn(),
        upsertCustomer: jest.fn(),
        getSupportedDocumentTypes: jest.fn().mockReturnValue([]),
        getUpo: jest.fn().mockResolvedValue(document),
      } as InvoicingPort;
      integrationsMock.getCapabilityAdapter.mockResolvedValue(adapter);

      const res = mockResponse();
      await upoController.downloadUpo('rec-inv-1', res);

      expect(integrationsMock.getCapabilityAdapter).toHaveBeenCalledWith('conn-ksef-1', 'Invoicing');
      expect(res.headers['Content-Type']).toBe('application/xml');
      expect(res.headers['Content-Disposition']).toContain('ol-upo-rec-inv-1.xml');
      expect(res.body).toEqual(Buffer.from([1, 2, 3]));
    });

    it('should 404 when the invoice id is unknown', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(upoController.downloadUpo('nope', mockResponse())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should 409 when the invoice is not yet cleared', async () => {
      repository.findById.mockResolvedValue(pendingRecord());

      await expect(
        upoController.downloadUpo('rec-inv-1', mockResponse()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(integrationsMock.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should 409 when the provider exposes no confirmation document', async () => {
      repository.findById.mockResolvedValue(clearedRecord());
      const adapter: InvoicingPort = {
        issueInvoice: jest.fn(),
        getInvoice: jest.fn(),
        upsertCustomer: jest.fn(),
        getSupportedDocumentTypes: jest.fn().mockReturnValue([]),
      };
      integrationsMock.getCapabilityAdapter.mockResolvedValue(adapter);

      await expect(
        upoController.downloadUpo('rec-inv-1', mockResponse()),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
