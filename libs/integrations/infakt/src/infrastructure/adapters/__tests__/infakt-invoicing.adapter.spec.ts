/**
 * Infakt Invoicing Adapter — unit tests
 *
 * Happy-path + error-path coverage per `InvoicingPort` / `RegulatoryStatusReader`
 * / `CorrectionIssuer` method, using `FakeInfaktHttpClient` in place of a real
 * `fetch`. Pins the fiscal-safety-critical cases: a 422 rejection propagates
 * with `failureMode: 'rejected'`, a 500 propagates with `failureMode:
 * 'in-doubt'`, and `getClearanceStatus` maps every `ksef_status` value onto
 * the neutral `RegulatoryStatus`.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters/__tests__
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import {
  BuyerProfile,
  InvoiceRecord,
  UnsupportedRegulatoryDocumentKindError,
} from '@openlinker/core/invoicing';
import type { IssueInvoiceCommand, IssueCorrectionCommand } from '@openlinker/core/invoicing';
import { InfaktInvoicingAdapter, INFAKT_PROVIDER_TYPE } from '../infakt-invoicing.adapter';
import { InfaktApiError } from '../../../domain/exceptions/infakt-api.error';
import { FakeInfaktHttpClient } from '../../../testing/fake-infakt-http-client';
import type {
  InfaktInvoice,
  InfaktClient,
  InfaktListResponse,
  InfaktBankAccount,
} from '../../../domain/types/infakt.types';

function fakeLogger(): jest.Mocked<LoggerPort> {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function buyer(overrides: Partial<{ nip: string | null }> = {}): BuyerProfile {
  return new BuyerProfile(
    'Acme Sp. z o.o.',
    overrides.nip === undefined || overrides.nip === null
      ? null
      : { scheme: 'pl-nip', value: overrides.nip },
    {
      line1: 'Testowa 1',
      line2: null,
      city: 'Warszawa',
      postalCode: '00-001',
      countryIso2: 'PL',
    },
    overrides.nip ? 'company' : 'private',
  );
}

function invoiceFixture(overrides: Partial<InfaktInvoice> = {}): InfaktInvoice {
  return {
    uuid: 'inv-uuid-1',
    number: 'FV/1/2026',
    kind: 'vat',
    status: 'sent',
    gross_price: 12300,
    net_price: 10000,
    tax_price: 2300,
    payment_method: 'transfer',
    invoice_date: '2026-07-01',
    sale_date: '2026-07-01',
    due_date: '2026-07-08',
    paid_date: null,
    corrected_invoice_number: null,
    correction_reason: null,
    correction_reason_symbol: null,
    ksef_number: null,
    ksef_data: null,
    client_id: 1,
    client_uuid: 'client-uuid-1',
    services: [
      {
        name: 'Widget',
        tax_symbol: '23',
        quantity: 1,
        unit: 'szt.',
        unit_net_price: 10000,
        net_price: 10000,
        tax_price: 2300,
        gross_price: 12300,
        correction: null,
        group: null,
      },
    ],
    ...overrides,
  };
}

function ksefResponseFixture(
  overrides: Partial<{ status: 'pending' | 'sent' | 'success' | 'error'; ksef_number: string | null }> = {},
): {
  request_uuid: string;
  invoice_uuid: string;
  invoice_kind: string;
  ksef_number: string | null;
  status: 'pending' | 'sent' | 'success' | 'error';
  status_description: string | null;
  timestamps: { request_created_at: string | null; request_finished_at: string | null };
} {
  return {
    request_uuid: 'req-uuid-1',
    invoice_uuid: 'inv-uuid-1',
    invoice_kind: 'vat',
    ksef_number: null,
    status: 'pending',
    status_description: 'Faktura oczekuje na wysłanie do KSeF.',
    timestamps: { request_created_at: '2026-07-01T12:00:00Z', request_finished_at: '2026-07-01T12:00:00Z' },
    ...overrides,
  };
}

describe('InfaktInvoicingAdapter', () => {
  let http: FakeInfaktHttpClient;
  let logger: jest.Mocked<LoggerPort>;
  let adapter: InfaktInvoicingAdapter;

  beforeEach(() => {
    http = new FakeInfaktHttpClient();
    logger = fakeLogger();
    adapter = new InfaktInvoicingAdapter('conn-1', http, logger);
  });

  describe('getSupportedDocumentTypes', () => {
    it('should return the neutral document types Infakt can issue', () => {
      expect(adapter.getSupportedDocumentTypes()).toEqual([
        'invoice',
        'corrected',
        'proforma',
        'prepayment',
      ]);
    });
  });

  describe('upsertCustomer', () => {
    it('should return an existing client found by NIP (happy path)', async () => {
      const existing: InfaktClient = {
        id: 1,
        uuid: 'client-existing',
        company_name: 'Acme',
        nip: '1234567890',
        email: null,
        city: null,
        street: null,
        postal_code: null,
        country: null,
      };
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', {
        entities: [existing],
        metainfo: { total_count: 1, next: null, previous: null },
      });

      const result = await adapter.upsertCustomer({
        connectionId: 'conn-1',
        buyer: buyer({ nip: '1234567890' }),
      });

      // The neutral providerCustomerId carries Infakt's NUMERIC client id
      // (not the uuid) — invoices.json only accepts client_id.
      expect(result).toEqual({ providerCustomerId: '1' });
    });

    it('should create a new client when no NIP match exists (happy path)', async () => {
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', {
        entities: [],
        metainfo: { total_count: 0, next: null, previous: null },
      });
      const created: InfaktClient = {
        id: 2,
        uuid: 'client-new',
        company_name: 'Acme',
        nip: '1234567890',
        email: null,
        city: 'Warszawa',
        street: 'Testowa 1',
        postal_code: '00-001',
        country: 'PL',
      };
      http.seed('POST', 'clients.json', created);

      const result = await adapter.upsertCustomer({
        connectionId: 'conn-1',
        buyer: buyer({ nip: '1234567890' }),
      });

      expect(result).toEqual({ providerCustomerId: '2' });
      // Field names verified live against the real Infakt v3 sandbox
      // (2026-07-01): `name`/`post_code` are silently rejected/ignored.
      const createCall = http.calls.find((c) => c.method === 'POST' && c.path === 'clients.json');
      expect(createCall?.body).toMatchObject({
        client: expect.objectContaining({ company_name: 'Acme Sp. z o.o.', postal_code: '00-001' }),
      });
    });

    it('should create a new client without a NIP lookup when the buyer has no tax id', async () => {
      const created: InfaktClient = {
        id: 3,
        uuid: 'client-no-nip',
        company_name: 'Jan Kowalski',
        nip: null,
        email: null,
        city: 'Warszawa',
        street: 'Testowa 1',
        postal_code: '00-001',
        country: 'PL',
      };
      http.seed('POST', 'clients.json', created);

      const result = await adapter.upsertCustomer({ connectionId: 'conn-1', buyer: buyer() });

      expect(result).toEqual({ providerCustomerId: '3' });
      expect(http.calls.some((c) => c.method === 'GET' && c.path === 'clients.json')).toBe(false);
    });

    it('should propagate InfaktApiError (with failureMode) on a client create rejection (error path)', async () => {
      http.seedError('POST', 'clients.json', new InfaktApiError('rejected', 422, { error: 'bad nip' }));

      await expect(
        adapter.upsertCustomer({ connectionId: 'conn-1', buyer: buyer({ nip: '0000000000' }) }),
      ).rejects.toMatchObject({ failureMode: 'rejected', statusCode: 422 });
    });
  });

  describe('issueInvoice', () => {
    const baseCmd: IssueInvoiceCommand = {
      connectionId: 'conn-1',
      orderId: 'order-1',
      buyer: buyer({ nip: '1234567890' }),
      currency: 'PLN',
      lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '23' }],
      idempotencyKey: 'idem-1',
    };

    beforeEach(() => {
      // upsertCustomer -> findClientByNip -> none found -> create
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', {
        entities: [],
        metainfo: { total_count: 0, next: null, previous: null },
      });
      http.seed('POST', 'clients.json', {
        id: 1,
        uuid: 'client-uuid-1',
        company_name: 'Acme',
        nip: '1234567890',
        email: null,
        city: null,
        street: null,
        postal_code: null,
        country: null,
      });
      // issueInvoice now submits to KSeF inline (issuing IS submitting) —
      // verified live (2026-07-01) that an Infakt draft never auto-submits.
      http.seed('POST', 'invoices/inv-uuid-1/send_to_ksef.json', ksefResponseFixture());
    });

    it('should issue an invoice and return an InvoiceRecord (happy path)', async () => {
      http.seed('POST', 'invoices.json', invoiceFixture());

      const { record, seller, sourceDocument } = await adapter.issueInvoice(baseCmd);

      expect(seller).toBeUndefined();
      expect(sourceDocument).toBeUndefined();
      expect(record).toBeInstanceOf(InvoiceRecord);
      expect(record.providerType).toBe(INFAKT_PROVIDER_TYPE);
      expect(record.providerInvoiceId).toBe('inv-uuid-1');
      expect(record.providerInvoiceNumber).toBe('FV/1/2026');
      expect(record.status).toBe('issued');
      expect(record.idempotencyKey).toBe('idem-1');
      // Infakt's invoice resource carries no `pdf_url` field (#1321) — the
      // real PDF is served via `RegulatoryDocumentReader.getRegulatoryDocument`.
      expect(record.pdfUrl).toBeNull();
      // KSeF submission is inline now — the record reflects the send_to_ksef
      // response, not the (necessarily stale, pre-submission) invoice payload.
      expect(record.regulatoryStatus).toBe('submitted');

      // Verified live against the real Infakt v3 sandbox (2026-07-01):
      // `payment_method: 'transfer'` 422s without a configured bank account,
      // and `client_uuid` is ignored — invoices.json needs the numeric
      // `client_id`.
      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      expect(invoiceCall?.body).toMatchObject({
        invoice: expect.objectContaining({ payment_method: 'cash', client_id: 1 }),
      });
      // issuing IS submitting for Infakt (draft never auto-submits) — verified
      // live (2026-07-01).
      expect(http.calls.some((c) => c.method === 'POST' && c.path === 'invoices/inv-uuid-1/send_to_ksef.json')).toBe(
        true,
      );
    });

    it('should default an empty taxRate to the Polish standard VAT rate (regime-rate fallback)', async () => {
      // Core always leaves InvoiceLine.taxRate empty (documented contract:
      // "the provider adapter resolves the regime rate"). Verified live
      // (2026-07-01): an empty tax_symbol cascades into services.gross /
      // value.tax_values rejections too — every real order line hit this.
      http.seed('POST', 'invoices.json', invoiceFixture());

      await adapter.issueInvoice({ ...baseCmd, lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '' }] });

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const services = (invoiceCall?.body as { invoice: { services: Array<{ tax_symbol: string; unit_net_price: number }> } })
        .invoice.services;
      expect(services[0].tax_symbol).toBe('23');
      expect(services[0].unit_net_price).toBe(10000);
    });

    it('should propagate a 422 InfaktApiError with failureMode: rejected (error path)', async () => {
      http.seedError(
        'POST',
        'invoices.json',
        new InfaktApiError('Infakt rejected the invoice', 422, { error: 'invalid tax data' }),
      );

      await expect(adapter.issueInvoice(baseCmd)).rejects.toMatchObject({
        failureMode: 'rejected',
        statusCode: 422,
      });
    });

    it('should propagate a 500 InfaktApiError with failureMode: in-doubt (error path)', async () => {
      http.seedError(
        'POST',
        'invoices.json',
        new InfaktApiError('Infakt server error', 500, { error: 'internal' }),
      );

      await expect(adapter.issueInvoice(baseCmd)).rejects.toMatchObject({
        failureMode: 'in-doubt',
        statusCode: 500,
      });
    });

    it('should propagate a failure from sendToKsef after the draft was already created (error path, #1293 review)', async () => {
      // The draft succeeds but the explicit KSeF submission kick fails — the
      // draft is left orphaned in Infakt (retry-safety assumption documented
      // inline on the sendToKsef call site).
      http.seed('POST', 'invoices.json', invoiceFixture());
      http.seedError(
        'POST',
        'invoices/inv-uuid-1/send_to_ksef.json',
        new InfaktApiError('Infakt server error', 500, { error: 'internal' }),
      );

      await expect(adapter.issueInvoice(baseCmd)).rejects.toMatchObject({
        failureMode: 'in-doubt',
        statusCode: 500,
      });
    });
  });

  describe('getInvoice', () => {
    it('should return null when the query is orderId-based (not supported by Infakt)', async () => {
      const result = await adapter.getInvoice({ orderId: 'order-1' });
      expect(result).toBeNull();
    });

    it('should return an InvoiceRecord when found by providerInvoiceId (happy path)', async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());

      const result = await adapter.getInvoice({ providerInvoiceId: 'inv-uuid-1' });

      expect(result).toBeInstanceOf(InvoiceRecord);
      expect(result?.providerInvoiceId).toBe('inv-uuid-1');
    });

    it('should return null on a 404 (error path)', async () => {
      http.seedError('GET', 'invoices/missing.json', new InfaktApiError('not found', 404, {}));

      const result = await adapter.getInvoice({ providerInvoiceId: 'missing' });

      expect(result).toBeNull();
    });

    it('should propagate a non-404 InfaktApiError (error path)', async () => {
      http.seedError('GET', 'invoices/inv-uuid-1.json', new InfaktApiError('server error', 500, {}));

      await expect(adapter.getInvoice({ providerInvoiceId: 'inv-uuid-1' })).rejects.toMatchObject({
        statusCode: 500,
      });
    });
  });

  describe('getClearanceStatus', () => {
    it('should return not-applicable when the record has no providerInvoiceId', async () => {
      const record = new InvoiceRecord(
        'id-1',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'invoice',
        'pending',
        null,
        null,
        'not-applicable',
        null,
        null,
        null,
        null,
        null,
        new Date(),
        new Date(),
      );

      const result = await adapter.getClearanceStatus(record);

      expect(result).toEqual({ regulatoryStatus: 'not-applicable' });
    });

    it.each([
      ['success', 'accepted'],
      ['pending', 'submitted'],
      ['sent', 'submitted'],
      ['error', 'rejected'],
    ] as const)('should map ksef_status %s to regulatoryStatus %s (happy path)', async (ksefStatus, expected) => {
      const record = new InvoiceRecord(
        'id-1',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'invoice',
        'issued',
        'inv-uuid-1',
        'FV/1/2026',
        'not-applicable',
        null,
        null,
        null,
        new Date(),
        null,
        new Date(),
        new Date(),
      );
      http.seed(
        'GET',
        'invoices/inv-uuid-1.json',
        invoiceFixture({
          ksef_data: {
            request_uuid: 'req-1',
            ksef_number: ksefStatus === 'success' ? 'KSeF-123' : null,
            status: ksefStatus,
            status_description: null,
            timestamps: { request_created_at: null, request_finished_at: null },
          },
        }),
      );

      const result = await adapter.getClearanceStatus(record);

      expect(result.regulatoryStatus).toBe(expected);
    });

    it('should return not-applicable when the invoice has no ksef_data', async () => {
      const record = new InvoiceRecord(
        'id-1',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'invoice',
        'issued',
        'inv-uuid-1',
        'FV/1/2026',
        'not-applicable',
        null,
        null,
        null,
        new Date(),
        null,
        new Date(),
        new Date(),
      );
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture({ ksef_data: null }));

      const result = await adapter.getClearanceStatus(record);

      expect(result.regulatoryStatus).toBe('not-applicable');
    });

    it('should propagate a transport error (error path)', async () => {
      const record = new InvoiceRecord(
        'id-1',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'invoice',
        'issued',
        'inv-uuid-1',
        'FV/1/2026',
        'not-applicable',
        null,
        null,
        null,
        new Date(),
        null,
        new Date(),
        new Date(),
      );
      http.seedError('GET', 'invoices/inv-uuid-1.json', new InfaktApiError('server error', 503, {}));

      await expect(adapter.getClearanceStatus(record)).rejects.toMatchObject({ statusCode: 503 });
    });
  });

  describe('issueCorrection', () => {
    const baseCmd: IssueCorrectionCommand = {
      connectionId: 'conn-1',
      orderId: 'order-1',
      originalProviderInvoiceId: 'inv-uuid-1',
      reason: 'Zwrot towaru',
      lines: [{ originalLineNumber: 1, newQuantity: 0 }],
      idempotencyKey: 'idem-corr-1',
    };

    it('should issue a correction and return an InvoiceRecord (happy path)', async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seed('POST', 'invoices.json', invoiceFixture({ uuid: 'corr-uuid-1', kind: 'corrective' }));
      // A correction is its own KSeF document — needs its own send_to_ksef
      // kick, same as the original (verified live, 2026-07-01).
      http.seed('POST', 'invoices/corr-uuid-1/send_to_ksef.json', ksefResponseFixture());

      const record = await adapter.issueCorrection(baseCmd);

      expect(record).toBeInstanceOf(InvoiceRecord);
      expect(record.providerInvoiceId).toBe('corr-uuid-1');
      expect(record.idempotencyKey).toBe('idem-corr-1');
      expect(record.regulatoryStatus).toBe('submitted');

      // Verified live against the real Infakt v3 sandbox (2026-07-01):
      // omitting client_id on a corrective invoice 422s with "client_id
      // required" — the original invoice's own client_id must be forwarded.
      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      expect(invoiceCall?.body).toMatchObject({
        invoice: expect.objectContaining({ client_id: 1 }),
      });
      expect(
        http.calls.some((c) => c.method === 'POST' && c.path === 'invoices/corr-uuid-1/send_to_ksef.json'),
      ).toBe(true);
    });

    it('should carry the original unit_net_price (plain integer groszy) through for the untouched-line fallback', async () => {
      // Infakt's wire format is a plain integer count of groszy (#1293 review
      // finding — the earlier "amount currency" string assumption understated
      // every invoice ~100x); baseCmd's line carries no newUnitPriceGross, so
      // both the "before" row and the fallback "after" row go through this path.
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seed('POST', 'invoices.json', invoiceFixture({ uuid: 'corr-uuid-1', kind: 'corrective' }));
      http.seed('POST', 'invoices/corr-uuid-1/send_to_ksef.json', ksefResponseFixture());

      await adapter.issueCorrection(baseCmd);

      const postCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const body = postCall?.body as {
        invoice: { services: { unit_net_price: number; correction: boolean }[] };
      };
      expect(body.invoice.services.find((s) => s.correction === false)?.unit_net_price).toBe(
        10000,
      );
      expect(body.invoice.services.find((s) => s.correction === true)?.unit_net_price).toBe(
        10000,
      );
    });

    it('should convert a price-changing correction line from gross to net, in groszy (#1292 review)', async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seed('POST', 'invoices.json', invoiceFixture({ uuid: 'corr-uuid-1', kind: 'corrective' }));
      http.seed('POST', 'invoices/corr-uuid-1/send_to_ksef.json', ksefResponseFixture());

      await adapter.issueCorrection({
        ...baseCmd,
        lines: [{ originalLineNumber: 1, newUnitPriceGross: 61.5 }],
      });

      const postCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const body = postCall?.body as {
        invoice: { services: { unit_net_price: number; correction: boolean }[] };
      };
      const correctedRow = body.invoice.services.find((s) => s.correction === true);
      // 61.5 gross / 1.23 (tax_symbol '23') = 50.00 net PLN = 5000 groszy —
      // was previously written straight through as "61.50 PLN" (61500 groszy
      // if naively converted), overstating the net price.
      expect(correctedRow?.unit_net_price).toBe(5000);
    });

    it('should propagate a 422 InfaktApiError with failureMode: rejected (error path)', async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seedError(
        'POST',
        'invoices.json',
        new InfaktApiError('Infakt rejected the correction', 422, { error: 'bad correction' }),
      );

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({
        failureMode: 'rejected',
        statusCode: 422,
      });
    });

    it('should propagate a 500 InfaktApiError with failureMode: in-doubt (error path)', async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seedError('POST', 'invoices.json', new InfaktApiError('server error', 500, {}));

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({
        failureMode: 'in-doubt',
        statusCode: 500,
      });
    });

    it('should propagate an error fetching the original invoice (error path)', async () => {
      http.seedError('GET', 'invoices/inv-uuid-1.json', new InfaktApiError('not found', 404, {}));

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('should propagate a failure from sendToKsef after the correction draft was already created (error path, #1293 review)', async () => {
      // Same orphaned-draft risk as issueInvoice's equivalent case — the
      // corrective draft succeeds but the explicit KSeF submission kick fails.
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seed('POST', 'invoices.json', invoiceFixture({ uuid: 'corr-uuid-1', kind: 'corrective' }));
      http.seedError(
        'POST',
        'invoices/corr-uuid-1/send_to_ksef.json',
        new InfaktApiError('Infakt server error', 500, { error: 'internal' }),
      );

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({
        failureMode: 'in-doubt',
        statusCode: 500,
      });
    });
  });

  describe('getRegulatoryDocument', () => {
    function recordFixture(): InvoiceRecord {
      const now = new Date('2026-07-01T12:00:00Z');
      return new InvoiceRecord(
        'record-1',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'invoice',
        'issued',
        'inv-uuid-1',
        'FV/1/2026',
        'accepted',
        'ksef-number-1',
        'idem-1',
        null,
        now,
        null,
        now,
        now,
      );
    }

    it('should fetch the PDF via the dedicated pdf.json endpoint (happy path)', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
      http.seedBinary('invoices/inv-uuid-1/pdf.json', {
        data: pdfBytes,
        contentType: 'application/pdf',
      });

      const document = await adapter.getRegulatoryDocument(recordFixture(), 'rendered');

      expect(document.content).toBe(pdfBytes);
      expect(document.contentType).toBe('application/pdf');
      const call = http.calls.find(
        (c) => c.method === 'GET_BINARY' && c.path === 'invoices/inv-uuid-1/pdf.json',
      );
      expect(call?.query).toEqual({ document_type: 'original', invoice_type: 'vat' });
    });

    it('should default to application/pdf when Infakt reports no content type', async () => {
      http.seedBinary('invoices/inv-uuid-1/pdf.json', {
        data: new Uint8Array([1, 2, 3]),
        contentType: '',
      });

      const document = await adapter.getRegulatoryDocument(recordFixture(), 'rendered');

      expect(document.contentType).toBe('application/pdf');
    });

    it('should throw UnsupportedRegulatoryDocumentKindError for confirmation (Infakt has no UPO of its own)', async () => {
      await expect(
        adapter.getRegulatoryDocument(recordFixture(), 'confirmation'),
      ).rejects.toBeInstanceOf(UnsupportedRegulatoryDocumentKindError);
    });

    it('should throw UnsupportedRegulatoryDocumentKindError for source', async () => {
      await expect(
        adapter.getRegulatoryDocument(recordFixture(), 'source'),
      ).rejects.toBeInstanceOf(UnsupportedRegulatoryDocumentKindError);
    });
  });

  describe('payment_method (#1303)', () => {
    const invoiceCmd: IssueInvoiceCommand = {
      connectionId: 'conn-1',
      orderId: 'order-1',
      buyer: buyer({ nip: '1234567890' }),
      currency: 'PLN',
      lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '23' }],
      idempotencyKey: 'idem-1',
    };
    const correctionCmd: IssueCorrectionCommand = {
      connectionId: 'conn-1',
      orderId: 'order-1',
      originalProviderInvoiceId: 'inv-uuid-1',
      reason: 'Zwrot towaru',
      lines: [{ originalLineNumber: 1, newQuantity: 0 }],
      idempotencyKey: 'idem-corr-1',
    };

    function seedIssueFixtures(): void {
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', {
        entities: [],
        metainfo: { total_count: 0, next: null, previous: null },
      });
      http.seed('POST', 'clients.json', {
        id: 1,
        uuid: 'client-uuid-1',
        name: 'Acme',
        nip: '1234567890',
        email: null,
        city: null,
        street: null,
        post_code: null,
        country: null,
      });
      http.seed('POST', 'invoices.json', invoiceFixture());
      // issuing IS submitting for Infakt - issueInvoice calls send_to_ksef inline
      http.seed('POST', 'invoices/inv-uuid-1/send_to_ksef.json', ksefResponseFixture());
    }

    function seedCorrectionFixtures(): void {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seed('POST', 'invoices.json', invoiceFixture({ uuid: 'corr-uuid-1', kind: 'corrective' }));
      // a correction is its own KSeF document - issueCorrection submits it inline
      http.seed('POST', 'invoices/corr-uuid-1/send_to_ksef.json', ksefResponseFixture());
    }

    it('should default to cash on issueInvoice when the connection has no defaultPaymentMethod configured', async () => {
      seedIssueFixtures();
      await adapter.issueInvoice(invoiceCmd);

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      expect(invoiceCall?.body).toMatchObject({ invoice: expect.objectContaining({ payment_method: 'cash' }) });
    });

    it('should use the configured defaultPaymentMethod on issueInvoice', async () => {
      const configured = new InfaktInvoicingAdapter('conn-1', http, logger, {
        defaultPaymentMethod: 'transfer',
      });
      seedIssueFixtures();
      await configured.issueInvoice(invoiceCmd);

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      expect(invoiceCall?.body).toMatchObject({
        invoice: expect.objectContaining({ payment_method: 'transfer' }),
      });
    });

    it('should default to cash on issueCorrection when the connection has no defaultPaymentMethod configured', async () => {
      seedCorrectionFixtures();
      await adapter.issueCorrection(correctionCmd);

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      expect(invoiceCall?.body).toMatchObject({ invoice: expect.objectContaining({ payment_method: 'cash' }) });
    });

    it('should use the same configured defaultPaymentMethod on issueCorrection as issueInvoice (no more disagreement)', async () => {
      const configured = new InfaktInvoicingAdapter('conn-1', http, logger, {
        defaultPaymentMethod: 'transfer',
      });
      seedCorrectionFixtures();
      await configured.issueCorrection(correctionCmd);

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      expect(invoiceCall?.body).toMatchObject({
        invoice: expect.objectContaining({ payment_method: 'transfer' }),
      });
    });
  });

  describe('bank accounts (#1303 follow-up)', () => {
    it('should map the bank-accounts list from snake_case to camelCase, including the default flag', async () => {
      http.seed<InfaktListResponse<InfaktBankAccount>>('GET', 'bank_accounts.json', {
        entities: [
          {
            id: 1,
            account_number: '61 1140 2004 0000 3002 0135 5387',
            bank_name: 'mBank',
            default: false,
          },
          {
            id: 2,
            account_number: '12 1090 1014 0000 0001 2345 6789',
            bank_name: 'Santander',
            default: true,
          },
        ],
        metainfo: { total_count: 2, next: null, previous: null },
      });

      const accounts = await adapter.listBankAccounts();

      expect(accounts).toEqual([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: false },
        { id: '2', accountNumber: '12 1090 1014 0000 0001 2345 6789', bankName: 'Santander', isDefault: true },
      ]);
    });

    it('should return an empty array when inFakt has no bank accounts configured', async () => {
      http.seed<InfaktListResponse<unknown>>('GET', 'bank_accounts.json', {
        entities: [],
        metainfo: { total_count: 0, next: null, previous: null },
      });

      await expect(adapter.listBankAccounts()).resolves.toEqual([]);
    });

    it('should PUT the account as default in inFakt', async () => {
      http.seed('PUT', 'bank_accounts/54946.json', {
        id: 54946,
        bank_name: 'Testowy Bank',
        account_number: '49915000093326449042496767',
        default: true,
      });

      await adapter.setDefaultBankAccount('54946');

      const putCall = http.calls.find((c) => c.method === 'PUT' && c.path === 'bank_accounts/54946.json');
      expect(putCall?.body).toEqual({ bank_account: { default: true } });
    });

    const invoiceCmd: IssueInvoiceCommand = {
      connectionId: 'conn-1',
      orderId: 'order-1',
      buyer: buyer({ nip: '1234567890' }),
      currency: 'PLN',
      lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '23' }],
      idempotencyKey: 'idem-1',
    };

    function seedIssueFixtures(): void {
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', {
        entities: [],
        metainfo: { total_count: 0, next: null, previous: null },
      });
      http.seed('POST', 'clients.json', {
        id: 1,
        uuid: 'client-uuid-1',
        name: 'Acme',
        nip: '1234567890',
        email: null,
        city: null,
        street: null,
        post_code: null,
        country: null,
      });
      http.seed('POST', 'invoices.json', invoiceFixture());
    }

    it('should attach bank_account/bank_name when transfer and a bank account are configured', async () => {
      const configured = new InfaktInvoicingAdapter('conn-1', http, logger, {
        defaultPaymentMethod: 'transfer',
        bankAccount: { id: 1, accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank' },
      });
      seedIssueFixtures();
      await configured.issueInvoice(invoiceCmd);

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      expect(invoiceCall?.body).toMatchObject({
        invoice: expect.objectContaining({
          bank_account: '61 1140 2004 0000 3002 0135 5387',
          bank_name: 'mBank',
        }),
      });
    });

    it('should omit bank_account/bank_name when transfer is chosen without a configured bank account', async () => {
      const configured = new InfaktInvoicingAdapter('conn-1', http, logger, {
        defaultPaymentMethod: 'transfer',
      });
      seedIssueFixtures();
      await configured.issueInvoice(invoiceCmd);

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const body = invoiceCall?.body as { invoice: Record<string, unknown> };
      expect(body.invoice.bank_account).toBeUndefined();
      expect(body.invoice.bank_name).toBeUndefined();
    });

    it('should omit bank_account/bank_name for cash even when a bank account is configured', async () => {
      const configured = new InfaktInvoicingAdapter('conn-1', http, logger, {
        defaultPaymentMethod: 'cash',
        bankAccount: { id: 1, accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank' },
      });
      seedIssueFixtures();
      await configured.issueInvoice(invoiceCmd);

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const body = invoiceCall?.body as { invoice: Record<string, unknown> };
      expect(body.invoice.bank_account).toBeUndefined();
      expect(body.invoice.bank_name).toBeUndefined();
    });
  });
});
