/**
 * InvoicingController unit tests (#1119, #1224)
 *
 * Covers all endpoints: the issue/retry/list endpoints (orders + invoice service
 * seams mocked — NO repository ports); and the UPO download endpoint (repository
 * + integrations service mocked).
 *
 * @module apps/api/src/invoicing/http
 */
import { Test } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  NotImplementedException,
  BadRequestException,
  BadGatewayException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  INVOICE_SERVICE_TOKEN,
  InvoiceRecord as InvoiceRecordClass,
  UnsupportedRegulatoryDocumentKindError,
  BuyerProfile,
} from '@openlinker/core/invoicing';
import type {
  IInvoiceService,
  InvoiceRecord,
  InvoicingPort,
  IssuedDocumentContent,
  RegulatoryDocument,
  StoredDocument,
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
import { Logger } from '@openlinker/shared/logging';
import { InvoicingController } from './invoicing.controller';

const NOW = new Date('2026-06-23T10:00:00.000Z');

// W2: SAMPLE_CONTENT and helpers used in content snapshot tests.
// clearedRecord() is defined in the UPO describe block below; forward-declared here
// for use by pendingRecord/recordWithContent at the top-level.
const SAMPLE_CONTENT: IssuedDocumentContent = {
  seller: {
    name: 'Acme Sp. z o.o.',
    taxId: { scheme: 'pl-nip', value: '1234567890' },
    address: { line1: 'ul. Testowa 1', line2: null, city: 'Warszawa', postalCode: '00-001', countryIso2: 'PL' },
  },
  buyer: {
    name: 'Jan Kowalski',
    taxId: null,
    address: { line1: 'ul. Kupna 2', line2: null, city: 'Kraków', postalCode: '30-001', countryIso2: 'PL' },
  },
  lines: [{ name: 'Widget', quantity: 1, unitNet: 100, taxRate: '23', net: 100, tax: 23, gross: 123 }],
  taxBreakdown: [{ rate: '23', net: 100, tax: 23, gross: 123 }],
  totals: { net: 100, tax: 23, gross: 123 },
  currency: 'PLN',
  issueDate: '2026-04-01T12:00:00.000Z',
  saleDate: null,
  payment: null,
};

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

function recordWithContent(content: IssuedDocumentContent | null): InvoiceRecord {
  const issuedAt = new Date('2026-04-01T12:00:00Z');
  const r = new InvoiceRecordClass(
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
    issuedAt,
    null,
    issuedAt,
    issuedAt,
    // failureMode, failureCode, failureReason, leaseExpiresAt, hasBuyerTaxId
    null, null, null, null, false,
    content,
  );
  return r as unknown as InvoiceRecord;
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

const SAMPLE_SOURCE: StoredDocument = {
  contentType: 'application/xml',
  contentBase64: Buffer.from('<Document>fake</Document>', 'utf-8').toString('base64'),
};

function recordWithSource(source: StoredDocument | null): InvoiceRecord {
  const issuedAt = new Date('2026-04-01T12:00:00Z');
  const r = new InvoiceRecordClass(
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
    issuedAt,
    null,
    issuedAt,
    issuedAt,
    // failureMode, failureCode, failureReason, leaseExpiresAt, hasBuyerTaxId, documentContent
    null, null, null, null, false, null,
    source,
  );
  return r as unknown as InvoiceRecord;
}

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

describe('InvoicingController', () => {
  let controller: InvoicingController;
  let invoiceService: jest.Mocked<IInvoiceService>;
  let orders: jest.Mocked<IOrderRecordService>;
  let integrations: jest.Mocked<IIntegrationsService>;

  beforeEach(async () => {
    invoiceService = {
      issueInvoice: jest.fn(),
      issueCorrection: jest.fn(),
      getInvoice: jest.fn().mockResolvedValue(null),
      getInvoiceById: jest.fn().mockResolvedValue(null),
      listInvoices: jest.fn(),
    } as unknown as jest.Mocked<IInvoiceService>;
    orders = {
      getOrderRecord: jest.fn(),
    } as unknown as jest.Mocked<IOrderRecordService>;

    const mockIntegrations = {
      getCapabilityAdapter: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [InvoicingController],
      providers: [
        { provide: INVOICE_SERVICE_TOKEN, useValue: invoiceService },
        { provide: ORDER_RECORD_SERVICE_TOKEN, useValue: orders },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: mockIntegrations },
      ],
    }).compile();

    controller = moduleRef.get(InvoicingController);
    integrations = moduleRef.get(INTEGRATIONS_SERVICE_TOKEN);
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

  describe('POST /invoices/:invoiceId/correct (#1288)', () => {
    const invoiceId = 'inv_1';
    const dto = { reason: 'Customer returned 1 unit', lines: [{ originalLineNumber: 1, newQuantity: 1 }] };

    it('404 NotFound when the invoice record does not exist', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(null);
      await expect(controller.issueCorrection(invoiceId, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('422 when the original invoice has no providerInvoiceId yet', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(
        makeInvoiceRecord({ providerInvoiceId: null }),
      );
      await expect(controller.issueCorrection(invoiceId, dto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('422 when the original invoice is missing document number / issue date', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(
        makeInvoiceRecord({ providerInvoiceNumber: null }),
      );
      await expect(controller.issueCorrection(invoiceId, dto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('passes originalDocument (rebuilt from the order snapshot) when the order is available', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(makeInvoiceRecord());
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.issueCorrection.mockResolvedValue(makeInvoiceRecord({ documentType: 'corrected' }));

      await controller.issueCorrection(invoiceId, dto);

      expect(invoiceService.issueCorrection).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn_1',
          orderId: 'ol_order_1',
          originalProviderInvoiceId: 'FV/2026/1',
          originalDocument: expect.objectContaining({
            currency: 'PLN',
            documentType: 'invoice',
            clearanceReference: null,
            documentNumber: 'FV/2026/1',
            issueDate: '2026-06-23',
            lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 100, taxRate: '' }],
          }),
        }),
      );
    });

    it('passes through documentType:corrected when correcting an already-corrected invoice', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(
        makeInvoiceRecord({ documentType: 'corrected' }),
      );
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.issueCorrection.mockResolvedValue(makeInvoiceRecord({ documentType: 'corrected' }));

      await controller.issueCorrection(invoiceId, dto);

      expect(invoiceService.issueCorrection).toHaveBeenCalledWith(
        expect.objectContaining({
          originalDocument: expect.objectContaining({ documentType: 'corrected' }),
        }),
      );
    });

    it('passes originalDocument: undefined when the backing order is no longer available', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(makeInvoiceRecord());
      orders.getOrderRecord.mockResolvedValue(null);
      invoiceService.issueCorrection.mockResolvedValue(makeInvoiceRecord({ documentType: 'corrected' }));

      await controller.issueCorrection(invoiceId, dto);

      expect(invoiceService.issueCorrection).toHaveBeenCalledWith(
        expect.objectContaining({ originalDocument: undefined }),
      );
    });

    it('maps a provider rejection to an HTTP exception via toHttpException', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(makeInvoiceRecord());
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord());
      invoiceService.issueCorrection.mockRejectedValue(
        new CapabilityNotSupportedException('conn_1', 'CorrectionIssuer'),
      );

      await expect(controller.issueCorrection(invoiceId, dto)).rejects.toThrow();
    });

    // #1297 — with a persisted issuance-time snapshot on the document being
    // corrected, the controller assembles `originalDocument` from it and skips
    // the order fetch entirely.
    const snapshotBuyer = new BuyerProfile(
      'ACME Sp. z o.o.',
      { scheme: 'pl-nip', value: '1234567890' },
      { line1: 'ul. X 1', line2: null, city: 'Poznań', postalCode: '60-001', countryIso2: 'PL' },
      'company',
    );
    const issuedSnapshot = {
      buyer: snapshotBuyer,
      currency: 'PLN',
      lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 100, taxRate: '23' }],
    };

    it('#1297: prefers the persisted issuedLineSnapshot and does NOT fetch the order', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(
        makeInvoiceRecord({ issuedLineSnapshot: issuedSnapshot, clearanceReference: 'KSEF-ORIG' }),
      );
      invoiceService.issueCorrection.mockResolvedValue(
        makeInvoiceRecord({ documentType: 'corrected' }),
      );

      await controller.issueCorrection(invoiceId, dto);

      expect(orders.getOrderRecord).not.toHaveBeenCalled();
      expect(invoiceService.issueCorrection).toHaveBeenCalledWith(
        expect.objectContaining({
          originalDocument: expect.objectContaining({
            currency: 'PLN',
            documentType: 'invoice',
            clearanceReference: 'KSEF-ORIG',
            documentNumber: 'FV/2026/1',
            issueDate: '2026-06-23',
            // Lines come from the snapshot (AS ISSUED), not the order.
            lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 100, taxRate: '23' }],
            // Buyer is re-wrapped into a real BuyerProfile with the true tax id.
            buyer: expect.objectContaining({
              name: 'ACME Sp. z o.o.',
              taxId: { scheme: 'pl-nip', value: '1234567890' },
              type: 'company',
            }),
          }),
        }),
      );
    });

    it('#1297: correction-of-correction reads the prior correction record own snapshot', async () => {
      const priorCorrectionSnapshot = {
        buyer: snapshotBuyer,
        currency: 'PLN',
        // Post-correction lines of the prior correction.
        lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 90, taxRate: '23' }],
      };
      invoiceService.getInvoiceById.mockResolvedValue(
        makeInvoiceRecord({
          documentType: 'corrected',
          issuedLineSnapshot: priorCorrectionSnapshot,
        }),
      );
      invoiceService.issueCorrection.mockResolvedValue(
        makeInvoiceRecord({ documentType: 'corrected' }),
      );

      await controller.issueCorrection(invoiceId, dto);

      expect(orders.getOrderRecord).not.toHaveBeenCalled();
      expect(invoiceService.issueCorrection).toHaveBeenCalledWith(
        expect.objectContaining({
          originalDocument: expect.objectContaining({
            documentType: 'corrected',
            lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 90, taxRate: '23' }],
          }),
        }),
      );
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
    it('should stream the UPO bytes for a cleared invoice (200)', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(clearedRecord());
      const document: RegulatoryDocument = {
        content: new Uint8Array([1, 2, 3]),
        contentType: 'application/xml',
      };
      const adapter: InvoicingPort = {
        issueInvoice: jest.fn(),
        getInvoice: jest.fn(),
        upsertCustomer: jest.fn(),
        getSupportedDocumentTypes: jest.fn().mockReturnValue([]),
        getRegulatoryDocument: jest.fn().mockResolvedValue(document),
      } as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      const res = mockResponse();
      await controller.downloadUpo('rec-inv-1', res);

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('conn-ksef-1', 'Invoicing');
      expect(res.headers['Content-Type']).toBe('application/xml');
      expect(res.headers['Content-Disposition']).toContain('ol-confirmation-rec-inv-1.xml');
      expect(res.body).toEqual(Buffer.from([1, 2, 3]));
    });

    it('should 404 when the invoice id is unknown', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(null);

      await expect(controller.downloadUpo('nope', mockResponse())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should 409 when the invoice is not yet cleared', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(pendingRecord());

      await expect(
        controller.downloadUpo('rec-inv-1', mockResponse()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should 409 when the provider exposes no confirmation document', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(clearedRecord());
      const adapter: InvoicingPort = {
        issueInvoice: jest.fn(),
        getInvoice: jest.fn(),
        upsertCustomer: jest.fn(),
        getSupportedDocumentTypes: jest.fn().mockReturnValue([]),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      await expect(
        controller.downloadUpo('rec-inv-1', mockResponse()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should 409 when the reader rejects the confirmation kind', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(clearedRecord());
      const adapter: InvoicingPort = {
        issueInvoice: jest.fn(),
        getInvoice: jest.fn(),
        upsertCustomer: jest.fn(),
        getSupportedDocumentTypes: jest.fn().mockReturnValue([]),
        getRegulatoryDocument: jest
          .fn()
          .mockRejectedValue(new UnsupportedRegulatoryDocumentKindError('confirmation')),
      } as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      await expect(
        controller.downloadUpo('rec-inv-1', mockResponse()),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getInvoice', () => {
    it('should return the record DTO (200)', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(clearedRecord());

      const dto = await controller.getInvoice('rec-inv-1');

      expect(dto.id).toBe('rec-inv-1');
      expect(dto.status).toBe('issued');
      expect(dto.regulatoryStatus).toBe('accepted');
      // Infrastructure-only fields are not surfaced.
      expect(dto).not.toHaveProperty('errorMessage');
      expect(dto).not.toHaveProperty('documentContent');
    });

    it('should 404 when the invoice id is unknown', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(null);

      await expect(controller.getInvoice('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getContent', () => {
    it('should return the content snapshot DTO (200)', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(recordWithContent(SAMPLE_CONTENT));

      const dto = await controller.getContent('rec-inv-1');

      expect(dto.currency).toBe('PLN');
      expect(dto.seller?.taxId).toEqual({ scheme: 'pl-nip', value: '1234567890' });
      expect(dto.totals).toEqual({ net: 100, tax: 23, gross: 123 });
      expect(dto.lines).toHaveLength(1);
      expect(dto.taxBreakdown).toEqual([{ rate: '23', net: 100, tax: 23, gross: 123 }]);
    });

    it('should 404 when the invoice id is unknown', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(null);

      await expect(controller.getContent('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should 409 when the invoice carries no content snapshot', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(recordWithContent(null));

      await expect(controller.getContent('rec-inv-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getDocument', () => {
    it('should stream the persisted source XML for kind=source (200), no provider call', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(recordWithSource(SAMPLE_SOURCE));

      const res = mockResponse();
      await controller.downloadDocument('rec-inv-1', res, 'source');

      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(res.headers['Content-Type']).toBe('application/xml');
      expect(res.headers['Content-Disposition']).toContain('ol-source-rec-inv-1.xml');
      expect(res.body).toEqual(Buffer.from('<Document>fake</Document>', 'utf-8'));
    });

    it('should default kind to source when the query param is absent', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(recordWithSource(SAMPLE_SOURCE));

      const res = mockResponse();
      await controller.downloadDocument('rec-inv-1', res, undefined);

      expect(res.body).toEqual(Buffer.from('<Document>fake</Document>', 'utf-8'));
    });

    it('should 404 when the invoice id is unknown', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(null);

      await expect(
        controller.downloadDocument('nope', mockResponse(), 'source'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should 409 for kind=source when no source snapshot exists', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(recordWithSource(null));

      await expect(
        controller.downloadDocument('rec-inv-1', mockResponse(), 'source'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should 400 on an unknown kind', async () => {
      await expect(
        controller.downloadDocument('rec-inv-1', mockResponse(), 'bogus'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(invoiceService.getInvoiceById).not.toHaveBeenCalled();
    });

    it('should 400 when kind=upo is passed (upo has its own dedicated route)', async () => {
      await expect(
        controller.downloadDocument('rec-inv-1', mockResponse(), 'upo'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(invoiceService.getInvoiceById).not.toHaveBeenCalled();
    });

    it('should 409 for kind=rendered when the provider cannot produce it', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(clearedRecord());
      const adapter: InvoicingPort = {
        issueInvoice: jest.fn(),
        getInvoice: jest.fn(),
        upsertCustomer: jest.fn(),
        getSupportedDocumentTypes: jest.fn().mockReturnValue([]),
        getRegulatoryDocument: jest
          .fn()
          .mockRejectedValue(new UnsupportedRegulatoryDocumentKindError('rendered')),
      } as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      await expect(
        controller.downloadDocument('rec-inv-1', mockResponse(), 'rendered'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should 409 for kind=rendered when the invoice is not yet cleared', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(pendingRecord());

      await expect(
        controller.downloadDocument('rec-inv-1', mockResponse(), 'rendered'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });
  });

  describe('GET /connections/:connectionId/bank-accounts (#1303 follow-up)', () => {
    it('should return the mapped bank-account list when the adapter implements BankAccountsReader', async () => {
      const adapter = {
        listBankAccounts: jest.fn().mockResolvedValue([
          {
            id: '1',
            accountNumber: '61 1140 2004 0000 3002 0135 5387',
            bankName: 'mBank',
            isDefault: true,
          },
        ]),
      } as unknown as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      const result = await controller.getBankAccounts('conn-infakt-1');

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('conn-infakt-1', 'Invoicing');
      expect(result).toEqual([
        {
          id: '1',
          accountNumber: '61 1140 2004 0000 3002 0135 5387',
          bankName: 'mBank',
          isDefault: true,
        },
      ]);
    });

    it('should 501 when the adapter does not implement BankAccountsReader', async () => {
      const adapter = {} as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      await expect(controller.getBankAccounts('conn-ksef-1')).rejects.toBeInstanceOf(
        NotImplementedException,
      );
    });

    it('should 502 when the adapter cannot be constructed (AdapterNotFoundException)', async () => {
      integrations.getCapabilityAdapter.mockRejectedValue(new AdapterNotFoundException('infakt'));

      await expect(controller.getBankAccounts('conn-infakt-1')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('should 502 with a generic message when the live provider call fails', async () => {
      const adapter = {
        listBankAccounts: jest.fn().mockRejectedValue(new Error('inFakt 500: seller NIP 123')),
      } as unknown as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      const rejection = controller.getBankAccounts('conn-infakt-1');
      await expect(rejection).rejects.toBeInstanceOf(BadGatewayException);
      // Provider error text must never be echoed back (PII posture).
      await expect(rejection).rejects.not.toThrow(/NIP 123/);
    });
  });

  describe('POST /connections/:connectionId/bank-accounts/:accountId/default (#1303 follow-up)', () => {
    it('should call setDefaultBankAccount when the adapter implements BankAccountDefaultSetter', async () => {
      const setDefaultBankAccount = jest.fn().mockResolvedValue(undefined);
      const adapter = {
        listBankAccounts: jest.fn(),
        setDefaultBankAccount,
      } as unknown as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      await controller.setDefaultBankAccount('conn-infakt-1', '1');

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('conn-infakt-1', 'Invoicing');
      expect(setDefaultBankAccount).toHaveBeenCalledWith('1');
    });

    it('should 501 when the adapter does not implement BankAccountDefaultSetter', async () => {
      const adapter = {} as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      await expect(controller.setDefaultBankAccount('conn-ksef-1', '1')).rejects.toBeInstanceOf(
        NotImplementedException,
      );
    });

    it('should 501 when the adapter exposes the setter without the inherited lister (guard requires both)', async () => {
      const adapter = { setDefaultBankAccount: jest.fn() } as unknown as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      await expect(controller.setDefaultBankAccount('conn-partial-1', '1')).rejects.toBeInstanceOf(
        NotImplementedException,
      );
    });

    it('should 502 when the live provider call fails', async () => {
      const adapter = {
        listBankAccounts: jest.fn(),
        setDefaultBankAccount: jest.fn().mockRejectedValue(new Error('inFakt 503')),
      } as unknown as InvoicingPort;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      await expect(controller.setDefaultBankAccount('conn-infakt-1', '1')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  describe('POST /invoices/:invoiceId/send-email (#1353)', () => {
    it('should trigger sendByEmail with the record providerInvoiceId + neutral options (no recipient override)', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(makeInvoiceRecord({ providerInvoiceId: 'inv-uuid-9' }));
      const sendByEmail = jest.fn().mockResolvedValue({ delivered: true, recipient: null });
      integrations.getCapabilityAdapter.mockResolvedValue({ sendByEmail } as unknown as InvoicingPort);

      const result = await controller.sendInvoiceEmail('inv_1', {
        locale: 'en',
        sendCopy: true,
      });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('conn_1', 'Invoicing');
      expect(sendByEmail).toHaveBeenCalledWith({
        externalInvoiceId: 'inv-uuid-9',
        locale: 'en',
        sendCopy: true,
      });
      expect(result).toEqual({ delivered: true, recipient: null });
    });

    it('should 404 when the invoice id is unknown', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(null);

      await expect(controller.sendInvoiceEmail('missing', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should 422 when the invoice has no provider invoice id', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(makeInvoiceRecord({ providerInvoiceId: null }));

      await expect(controller.sendInvoiceEmail('inv_1', {})).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('should 501 when the adapter does not implement InvoiceEmailSender', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(makeInvoiceRecord());
      integrations.getCapabilityAdapter.mockResolvedValue({} as InvoicingPort);

      await expect(controller.sendInvoiceEmail('inv_1', {})).rejects.toBeInstanceOf(
        NotImplementedException,
      );
    });

    it('should 502 with a generic message when the live provider call fails', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(makeInvoiceRecord());
      const sendByEmail = jest.fn().mockRejectedValue(new Error('inFakt 500: buyer bob@secret.pl'));
      integrations.getCapabilityAdapter.mockResolvedValue({ sendByEmail } as unknown as InvoicingPort);

      const rejection = controller.sendInvoiceEmail('inv_1', {});
      await expect(rejection).rejects.toBeInstanceOf(BadGatewayException);
      await expect(rejection).rejects.not.toThrow(/secret\.pl/);
    });

    it('should scrub the buyer email from the warn log on a provider failure', async () => {
      invoiceService.getInvoiceById.mockResolvedValue(makeInvoiceRecord());
      const sendByEmail = jest.fn().mockRejectedValue(new Error('inFakt 500: buyer bob@secret.pl'));
      integrations.getCapabilityAdapter.mockResolvedValue({ sendByEmail } as unknown as InvoicingPort);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(controller.sendInvoiceEmail('inv_1', {})).rejects.toBeInstanceOf(BadGatewayException);

      expect(warnSpy).toHaveBeenCalledWith(expect.not.stringContaining('bob@secret.pl'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[redacted-email]'));
      warnSpy.mockRestore();
    });
  });
});
