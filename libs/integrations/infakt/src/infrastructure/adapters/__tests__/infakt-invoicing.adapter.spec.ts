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
import { BuyerProfile, InvoiceRecord } from '@openlinker/core/invoicing';
import type { IssueInvoiceCommand, IssueCorrectionCommand } from '@openlinker/core/invoicing';
import { InfaktInvoicingAdapter, INFAKT_PROVIDER_TYPE } from '../infakt-invoicing.adapter';
import { InfaktApiError } from '../../../domain/exceptions/infakt-api.error';
import { FakeInfaktHttpClient } from '../../../testing/fake-infakt-http-client';
import type { InfaktInvoice, InfaktClient, InfaktListResponse } from '../../../domain/types/infakt.types';

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
    gross_price: '123.00 PLN',
    net_price: '100.00 PLN',
    tax_price: '23.00 PLN',
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
        unit_net_price: '100.00 PLN',
        net_price: '100.00 PLN',
        tax_price: '23.00 PLN',
        gross_price: '123.00 PLN',
        correction: null,
        group: null,
      },
    ],
    print_url: null,
    pdf_url: 'https://infakt.pl/inv-uuid-1.pdf',
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
        name: 'Acme',
        nip: '1234567890',
        email: null,
        city: null,
        street: null,
        post_code: null,
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

      expect(result).toEqual({ providerCustomerId: 'client-existing' });
    });

    it('should create a new client when no NIP match exists (happy path)', async () => {
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', {
        entities: [],
        metainfo: { total_count: 0, next: null, previous: null },
      });
      const created: InfaktClient = {
        id: 2,
        uuid: 'client-new',
        name: 'Acme',
        nip: '1234567890',
        email: null,
        city: 'Warszawa',
        street: 'Testowa 1',
        post_code: '00-001',
        country: 'PL',
      };
      http.seed('POST', 'clients.json', created);

      const result = await adapter.upsertCustomer({
        connectionId: 'conn-1',
        buyer: buyer({ nip: '1234567890' }),
      });

      expect(result).toEqual({ providerCustomerId: 'client-new' });
    });

    it('should create a new client without a NIP lookup when the buyer has no tax id', async () => {
      const created: InfaktClient = {
        id: 3,
        uuid: 'client-no-nip',
        name: 'Jan Kowalski',
        nip: null,
        email: null,
        city: 'Warszawa',
        street: 'Testowa 1',
        post_code: '00-001',
        country: 'PL',
      };
      http.seed('POST', 'clients.json', created);

      const result = await adapter.upsertCustomer({ connectionId: 'conn-1', buyer: buyer() });

      expect(result).toEqual({ providerCustomerId: 'client-no-nip' });
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
        name: 'Acme',
        nip: '1234567890',
        email: null,
        city: null,
        street: null,
        post_code: null,
        country: null,
      });
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
      expect(record.pdfUrl).toBe('https://infakt.pl/inv-uuid-1.pdf');
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
      ['success', 'cleared'],
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

      const record = await adapter.issueCorrection(baseCmd);

      expect(record).toBeInstanceOf(InvoiceRecord);
      expect(record.providerInvoiceId).toBe('corr-uuid-1');
      expect(record.idempotencyKey).toBe('idem-corr-1');
    });

    it('should parse Infakt\'s "amount currency" unit_net_price string for the untouched-line fallback', async () => {
      // Infakt returns unit_net_price as "100.00 PLN", never a plain number
      // (#1292 review); baseCmd's line carries no newUnitPriceGross, so both
      // the "before" row and the fallback "after" row go through this path.
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seed('POST', 'invoices.json', invoiceFixture({ uuid: 'corr-uuid-1', kind: 'corrective' }));

      await adapter.issueCorrection(baseCmd);

      const postCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const body = postCall?.body as {
        invoice: { services: { unit_net_price: string; correction: boolean }[] };
      };
      expect(body.invoice.services.find((s) => s.correction === false)?.unit_net_price).toBe(
        '100.00 PLN',
      );
      expect(body.invoice.services.find((s) => s.correction === true)?.unit_net_price).toBe(
        '100.00 PLN',
      );
    });

    it('should convert a price-changing correction line from gross to net (#1292 review)', async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seed('POST', 'invoices.json', invoiceFixture({ uuid: 'corr-uuid-1', kind: 'corrective' }));

      await adapter.issueCorrection({
        ...baseCmd,
        lines: [{ originalLineNumber: 1, newUnitPriceGross: 61.5 }],
      });

      const postCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const body = postCall?.body as {
        invoice: { services: { unit_net_price: string; correction: boolean }[] };
      };
      const correctedRow = body.invoice.services.find((s) => s.correction === true);
      // 61.5 gross / 1.23 (tax_symbol '23') = 50.00 net — was previously written
      // straight through as "61.50 PLN", overstating the net price.
      expect(correctedRow?.unit_net_price).toBe('50.00 PLN');
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
    }

    function seedCorrectionFixtures(): void {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seed('POST', 'invoices.json', invoiceFixture({ uuid: 'corr-uuid-1', kind: 'corrective' }));
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
});
