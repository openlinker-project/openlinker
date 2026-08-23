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
 * List-envelope seeds derive from the committed sandbox captures under
 * `__fixtures__/` (see that folder's README) rather than from hand-written
 * literals — #1373/#1374 rewrote every literal here to a shape inFakt never
 * emits and the suite stayed green while the adapter was broken in production
 * (#1926).
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters/__tests__
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { LoggerPort } from '@openlinker/shared/logging';
import {
  BuyerProfile,
  CURRENCY_REJECTION_MARKERS,
  FractionalTaxRateNotationError,
  MissingTaxRateException,
  InvoiceRecord,
  UnsupportedRegulatoryDocumentKindError,
} from '@openlinker/core/invoicing';
import type { IssueInvoiceCommand, IssueCorrectionCommand } from '@openlinker/core/invoicing';
import { InfaktInvoicingAdapter, INFAKT_PROVIDER_TYPE } from '../infakt-invoicing.adapter';
import { InfaktApiError } from '../../../domain/exceptions/infakt-api.error';
import { FakeInfaktHttpClient } from '../../../testing/fake-infakt-http-client';
import type {
  InfaktAsyncTaskAccepted,
  InfaktInvoice,
  InfaktClient,
  InfaktListResponse,
  InfaktBankAccount,
} from '../../../domain/types/infakt.types';

function fakeLogger(): jest.Mocked<LoggerPort> {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

const FIXTURES_DIR = resolve(__dirname, '..', '__fixtures__');

function loadListFixture<T>(file: string): InfaktListResponse<T> {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, file), 'utf8')) as InfaktListResponse<T>;
}

/** Real `GET /clients.json` capture — the NIP-carrying row is `entities[1]`. */
const CLIENTS_CAPTURE = loadListFixture<InfaktClient>('clients-list-response.json');
/** Real `GET /bank_accounts.json` capture — two accounts, the second is default. */
const BANK_ACCOUNTS_CAPTURE = loadListFixture<InfaktBankAccount>('bank-accounts-list-response.json');

/**
 * A list envelope carrying `entities`, with the captured `metainfo` block so the
 * seeded shape stays wire-faithful whatever rows a given test needs.
 */
function listResponse<T>(entities: T[]): InfaktListResponse<T> {
  return { entities, metainfo: { ...CLIENTS_CAPTURE.metainfo, total_count: entities.length } };
}

function buyer(overrides: Partial<{ nip: string | null; email: string | null }> = {}): BuyerProfile {
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
    overrides.email ?? null,
  );
}

function invoiceFixture(overrides: Partial<InfaktInvoice> = {}): InfaktInvoice {
  return {
    uuid: 'inv-uuid-1',
    number: 'FV/1/2026',
    kind: 'vat',
    status: 'sent',
    // Present on every live read of both document resources (#2103).
    currency: 'PLN',
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

/**
 * Task envelope returned by `POST async/corrective_invoices.json` and by
 * `GET async/corrective_invoices/status/{ref}.json` (#1763).
 *
 * Defaults to the TERMINAL-SUCCESS shape confirmed live (2026-07-28):
 * `processing_code: 201` + `invoice_uuid`. Override `processing_code: 100` for
 * the still-processing envelope, or a 4xx for the failure envelope — note
 * `invoice_kind` is echoed on ALL THREE (it names the requested resource, not
 * the outcome), so only `invoice_uuid` discriminates success.
 */
function asyncTaskFixture(
  overrides: Partial<InfaktAsyncTaskAccepted> = {},
): InfaktAsyncTaskAccepted {
  return {
    invoice_task_reference_number: 'task-ref-1',
    processing_code: 201,
    processing_description: 'Faktura stworzona',
    timestamps: { task_created_at: '2026-07-28 16:53:00 +0200' },
    action: 'create_invoice',
    invoice_kind: 'corrective_invoice',
    invoice_uuid: 'corr-uuid-1',
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
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([existing]));

      const result = await adapter.upsertCustomer({
        connectionId: 'conn-1',
        buyer: buyer({ nip: '1234567890' }),
      });

      // The neutral providerCustomerId carries Infakt's NUMERIC client id
      // (not the uuid) — invoices.json only accepts client_id.
      expect(result).toEqual({ providerCustomerId: '1' });
    });

    it('should create a new client when no NIP match exists (happy path)', async () => {
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([]));
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

    // #1926: the OUTGOING query is the half no previous spec asserted, which is
    // why a bare `?nip=` — silently ignored by inFakt, answered with the whole
    // unfiltered first page — shipped undetected. `q[clean_nip_eq]` is the key
    // that both filters AND matches a NIP inFakt stored with separators or a
    // country prefix; plain `q[nip_eq]` misses those and mints a duplicate.
    it('should look the client up with the Ransack q[clean_nip_eq] filter, not a bare nip param', async () => {
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([]));
      http.seed('POST', 'clients.json', { ...CLIENTS_CAPTURE.entities[1], id: 7 });

      await adapter.upsertCustomer({ connectionId: 'conn-1', buyer: buyer({ nip: '1234563218' }) });

      const lookup = http.calls.find((c) => c.method === 'GET' && c.path === 'clients.json');
      expect(lookup?.query).toEqual({ 'q[clean_nip_eq]': '1234563218', limit: '25' });
      expect(lookup?.query).not.toHaveProperty('nip');
      expect(lookup?.query).not.toHaveProperty('q[nip_eq]');
    });

    // The NIP is normalised on BOTH the lookup and the create (verified live,
    // #1926): the filter tolerates either form, but the stored value is what a
    // human reads on the invoice and what the client-side re-match compares.
    it('should normalise a prefixed or separator-formatted NIP for both the lookup and the create', async () => {
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([]));
      http.seed('POST', 'clients.json', { ...CLIENTS_CAPTURE.entities[1], id: 8 });

      await adapter.upsertCustomer({
        connectionId: 'conn-1',
        buyer: buyer({ nip: 'PL123-456-32-18' }),
      });

      const lookup = http.calls.find((c) => c.method === 'GET' && c.path === 'clients.json');
      expect(lookup?.query).toMatchObject({ 'q[clean_nip_eq]': '1234563218' });
      const createCall = http.calls.find((c) => c.method === 'POST' && c.path === 'clients.json');
      expect(createCall?.body).toMatchObject({
        client: expect.objectContaining({ nip: '1234563218' }),
      });
    });

    // The filter is a hint, never identity proof: an unrecognised filter key
    // makes inFakt answer 200 with the seller's whole page, so the returned
    // client's NIP is re-matched. Adopting `entities[0]` blindly would reference
    // a wrong `client_id` on a KSeF-cleared invoice (#1926).
    it('should not adopt a returned client whose NIP differs from the requested one', async () => {
      const otherCompany = CLIENTS_CAPTURE.entities[1];
      expect(otherCompany.nip).toBe('1234563218');
      http.seed<InfaktListResponse<InfaktClient>>(
        'GET',
        'clients.json',
        listResponse([CLIENTS_CAPTURE.entities[0], otherCompany]),
      );
      http.seed('POST', 'clients.json', { ...otherCompany, id: 9, nip: '9999999999' });

      const result = await adapter.upsertCustomer({
        connectionId: 'conn-1',
        buyer: buyer({ nip: '9999999999' }),
      });

      expect(result).toEqual({ providerCustomerId: '9' });
      expect(http.calls.some((c) => c.method === 'POST' && c.path === 'clients.json')).toBe(true);
    });

    // inFakt does not dedupe clients server-side (two POSTs with the same NIP
    // both 201) and the #1373/#1374 regression minted one duplicate per
    // issuance, so real accounts hold several rows per NIP. An exact-NIP match
    // is the same legal entity, so the oldest is reused deterministically —
    // declining to match would keep minting duplicates (#1926).
    it('should reuse the oldest client and warn when several clients share the requested NIP', async () => {
      const template = CLIENTS_CAPTURE.entities[1];
      http.seed<InfaktListResponse<InfaktClient>>(
        'GET',
        'clients.json',
        listResponse([
          { ...template, id: 300, uuid: 'dup-newest' },
          { ...template, id: 100, uuid: 'dup-oldest' },
          { ...template, id: 200, uuid: 'dup-middle' },
        ]),
      );

      const result = await adapter.upsertCustomer({
        connectionId: 'conn-1',
        buyer: buyer({ nip: '1234563218' }),
      });

      expect(result).toEqual({ providerCustomerId: '100' });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('3 clients for NIP 1234563218'));
      expect(http.calls.some((c) => c.method === 'POST' && c.path === 'clients.json')).toBe(false);
    });

    // A failed lookup must NOT read as "no such client": the pre-#1926 bare
    // `catch { return null }` turned every transport/5xx failure into another
    // duplicate client in the seller's accounting records, silently.
    it('should propagate a lookup failure instead of creating a duplicate client', async () => {
      http.seedError(
        'GET',
        'clients.json',
        new InfaktApiError('Infakt API GET clients.json failed with status 500', 500, null),
      );
      http.seed('POST', 'clients.json', { ...CLIENTS_CAPTURE.entities[1], id: 10 });

      await expect(
        adapter.upsertCustomer({ connectionId: 'conn-1', buyer: buyer({ nip: '1234563218' }) }),
      ).rejects.toThrow(InfaktApiError);
      expect(http.calls.some((c) => c.method === 'POST' && c.path === 'clients.json')).toBe(false);
    });

    it('includes the buyer email in the create payload when known (#1797)', async () => {
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([]));
      const created: InfaktClient = {
        id: 4,
        uuid: 'client-with-email',
        company_name: 'Acme',
        nip: '1234567890',
        email: 'buyer@example.com',
        city: 'Warszawa',
        street: 'Testowa 1',
        postal_code: '00-001',
        country: 'PL',
      };
      http.seed('POST', 'clients.json', created);

      await adapter.upsertCustomer({
        connectionId: 'conn-1',
        buyer: buyer({ nip: '1234567890', email: 'buyer@example.com' }),
      });

      const createCall = http.calls.find((c) => c.method === 'POST' && c.path === 'clients.json');
      const body = createCall?.body as { client: Record<string, unknown> };
      expect(body.client.email).toBe('buyer@example.com');
    });

    it('omits the email key from the create payload when the buyer has none (#1797)', async () => {
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([]));
      const created: InfaktClient = {
        id: 5,
        uuid: 'client-no-email',
        company_name: 'Acme',
        nip: '1234567890',
        email: null,
        city: 'Warszawa',
        street: 'Testowa 1',
        postal_code: '00-001',
        country: 'PL',
      };
      http.seed('POST', 'clients.json', created);

      await adapter.upsertCustomer({
        connectionId: 'conn-1',
        buyer: buyer({ nip: '1234567890' }),
      });

      const createCall = http.calls.find((c) => c.method === 'POST' && c.path === 'clients.json');
      const body = createCall?.body as { client: Record<string, unknown> };
      // `undefined` (not absent) at this layer — the fake HTTP client captures
      // the raw pre-serialization object; `JSON.stringify` (the real transport,
      // `InfaktHttpClient.post`) is what actually drops an `undefined` key from
      // the wire payload, mirroring the pre-existing `nip: nip ?? undefined`
      // behavior in the same object literal.
      expect(body.client.email).toBeUndefined();
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
      // The lookup must be seeded explicitly now that a failed lookup no longer
      // degrades into "no match" (#1926) — this test is about the CREATE call.
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([]));
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
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([]));
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

    it('should stamp the command currency on the invoice payload (#2103)', async () => {
      http.seed('POST', 'invoices.json', invoiceFixture({ currency: 'EUR' }));

      await adapter.issueInvoice({ ...baseCmd, currency: 'EUR' });

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      expect(invoiceCall?.body).toMatchObject({
        invoice: expect.objectContaining({ currency: 'EUR' }),
      });
    });

    it('should never fall back to the account default currency for a non-PLN command (#2103)', async () => {
      // The whole point of #2103: omitting `currency` makes Infakt book the
      // document in the account's default (PLN) with no error anywhere, and
      // Infakt relays it to KSeF. A EUR command must reach the wire as EUR.
      http.seed('POST', 'invoices.json', invoiceFixture({ currency: 'EUR' }));

      await adapter.issueInvoice({ ...baseCmd, currency: 'EUR' });

      const invoice = (
        http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json')?.body as {
          invoice: Record<string, unknown>;
        }
      ).invoice;
      expect(invoice).toHaveProperty('currency');
      expect(invoice.currency).not.toBe('PLN');
    });

    it('should normalise a lower-case currency code to Infakt uppercase (#2103)', async () => {
      http.seed('POST', 'invoices.json', invoiceFixture({ currency: 'EUR' }));

      await adapter.issueInvoice({ ...baseCmd, currency: 'eur' });

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      expect(invoiceCall?.body).toMatchObject({
        invoice: expect.objectContaining({ currency: 'EUR' }),
      });
    });

    it.each([['', 'blank'], ['PLNN', 'over-long'], ['EU2', 'non-alphabetic']])(
      'should reject a malformed currency (%s, %s) before any provider call (#2103)',
      async (currency) => {
        http.seed('POST', 'invoices.json', invoiceFixture());

        // 422 -> failureMode 'rejected': nothing crossed the provider boundary,
        // so the operator can safely re-submit. The alternative (dropping the
        // field) is a silently mis-denominated, KSeF-cleared document.
        await expect(adapter.issueInvoice({ ...baseCmd, currency })).rejects.toMatchObject({
          statusCode: 422,
        });
        expect(http.calls).toHaveLength(0);
      },
    );

    it('should phrase the refusal so core still classifies it as invalid-currency (#2103 review)', async () => {
      // Core's `classifyFailureCode` resolves the operator-facing
      // `invalid-currency` code by a structural substring read of the rejection
      // reason (the same pattern the tax-id markers use). That makes the message
      // thrown HERE part of the contract: reword it out of every marker and the
      // operator silently drops back to "the provider rejected the request" -
      // which is false, since nothing was sent. Asserted from the side that
      // changes, against the published marker list rather than a copied string.
      http.seed('POST', 'invoices.json', invoiceFixture());

      const error = await adapter
        .issueInvoice({ ...baseCmd, currency: '' })
        .then(() => null)
        .catch((e: unknown) => e as Error);

      const haystack = (error?.message ?? '').toLowerCase();
      expect(error).toBeInstanceOf(InfaktApiError);
      expect(CURRENCY_REJECTION_MARKERS.some((marker) => haystack.includes(marker))).toBe(true);
    });

    it('should refuse an empty taxRate rather than defaulting it when the switch is on (#2257)', async () => {
      // The 23% fallback is the thing #2245 exists to remove. A silent 23% is
      // indistinguishable from a confirmed 23% on the issued document, and the
      // whole cost of being wrong lands on the seller. Under strict enforcement
      // the refusal is local, so no draft is left behind.
      //
      // The old live finding still holds and is why nothing is lost: an empty
      // tax_symbol cascades into services.gross / value.tax_values rejections
      // (verified 2026-07-01), so a rate-less line was never going to produce a
      // document anyway. It now fails naming the product instead of a wire field.
      const previous = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      process.env['OL_TAX_RATE_STRICT_ENABLED'] = 'true';
      try {
        http.seed('POST', 'invoices.json', invoiceFixture());

        await expect(
          adapter.issueInvoice({
            ...baseCmd,
            lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '' }],
          }),
        ).rejects.toBeInstanceOf(MissingTaxRateException);

        expect(
          http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json'),
        ).toBeUndefined();
      } finally {
        if (previous === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previous;
      }
    });

    it('should substitute its documented default while the switch is off - the default', async () => {
      // Coverage is zero on deploy, so the default survives until an operator
      // opts in. If this goes red the rollout became an outage.
      const previous = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
      try {
        http.seed('POST', 'invoices.json', invoiceFixture());

        await adapter.issueInvoice({
          ...baseCmd,
          lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '' }],
        });

        const call = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
        expect(call).toBeDefined();
      } finally {
        if (previous === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previous;
      }
    });

    it('should read "23" as twenty-three percent when splitting gross into net (#2247)', async () => {
      // Percent-as-string is the neutral contract. 123 gross at 23% is 100.00
      // net, i.e. 10000 groszy.
      http.seed('POST', 'invoices.json', invoiceFixture());

      await adapter.issueInvoice({
        ...baseCmd,
        lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '23' }],
      });

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const services = (
        invoiceCall?.body as { invoice: { services: Array<{ tax_symbol: string; unit_net_price: number }> } }
      ).invoice.services;
      expect(services[0].tax_symbol).toBe('23');
      expect(services[0].unit_net_price).toBe(10000);
    });

    it('should read "1" as one percent rather than one hundred percent (#2247)', async () => {
      // The pre-#2247 `n > 1` heuristic read this as a fraction, so a 1% line
      // was split as if it carried 100% tax - 61.50 net instead of 121.78.
      http.seed('POST', 'invoices.json', invoiceFixture());

      await adapter.issueInvoice({
        ...baseCmd,
        lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '1' }],
      });

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const services = (invoiceCall?.body as { invoice: { services: Array<{ unit_net_price: number }> } })
        .invoice.services;
      expect(services[0].unit_net_price).toBe(12178);
    });

    it('should reject a fractional-looking taxRate rather than reinterpreting it (#2247)', async () => {
      // "0.23" read as a percentage is 0.23%, read as a fraction it is 23%.
      // Nothing in the value says which, so it is refused before any request.
      http.seed('POST', 'invoices.json', invoiceFixture());

      await expect(
        adapter.issueInvoice({
          ...baseCmd,
          lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '0.23' }],
        }),
      ).rejects.toBeInstanceOf(FractionalTaxRateNotationError);
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

    it('should fall back to corrective_invoices when the invoices path 404s (corrective uuid, #1337)', async () => {
      // GET /invoices/{uuid}.json returns 404 for corrective uuids (verified
      // live, 2026-07-03) — the corrective resource is the only read path.
      http.seedError('GET', 'invoices/corr-uuid-1.json', new InfaktApiError('not found', 404, {}));
      http.seed(
        'GET',
        'corrective_invoices/corr-uuid-1.json',
        invoiceFixture({ uuid: 'corr-uuid-1', kind: 'correction' }),
      );

      const result = await adapter.getInvoice({ providerInvoiceId: 'corr-uuid-1' });

      expect(result?.providerInvoiceId).toBe('corr-uuid-1');
      expect(result?.documentType).toBe('corrected');
    });

    it('should return null on a 404 from both resources (error path)', async () => {
      http.seedError('GET', 'invoices/missing.json', new InfaktApiError('not found', 404, {}));
      http.seedError(
        'GET',
        'corrective_invoices/missing.json',
        new InfaktApiError('not found', 404, {}),
      );

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

    it('should read corrective_invoices/{uuid}.json for a corrected record (#1337)', async () => {
      // The invoices/… path 404s for corrective uuids (verified live,
      // 2026-07-03) — the reconcile job's poll must branch on documentType.
      const record = new InvoiceRecord(
        'id-1',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'corrected',
        'issued',
        'corr-uuid-1',
        'FK/1/2026',
        'submitted',
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
        'corrective_invoices/corr-uuid-1.json',
        invoiceFixture({
          uuid: 'corr-uuid-1',
          kind: 'correction',
          ksef_data: {
            request_uuid: 'req-1',
            ksef_number: 'KSeF-KOR-1',
            status: 'success',
            status_description: null,
            timestamps: { request_created_at: null, request_finished_at: null },
          },
        }),
      );

      const result = await adapter.getClearanceStatus(record);

      expect(result).toEqual({ regulatoryStatus: 'accepted', clearanceReference: 'KSeF-KOR-1' });
      expect(
        http.calls.some((c) => c.method === 'GET' && c.path === 'corrective_invoices/corr-uuid-1.json'),
      ).toBe(true);
      expect(http.calls.some((c) => c.path.startsWith('invoices/'))).toBe(false);
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

  describe('getPaymentStatus (#1354)', () => {
    function issuedRecord(): InvoiceRecord {
      return new InvoiceRecord(
        'id-1',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'invoice',
        'issued',
        'inv-uuid-1',
        'FV/1/2026',
        'accepted',
        'KSeF-1',
        null,
        null,
        new Date(),
        null,
        new Date(),
        new Date(),
      );
    }

    it('should return unknown when the record has no providerInvoiceId', async () => {
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

      expect(await adapter.getPaymentStatus(record)).toEqual({ paymentStatus: 'unknown' });
    });

    it.each([
      ['paid', null, 'paid'],
      ['partly_paid', null, 'partially-paid'],
      // `partial_payment` is Infakt's payment_statuses-dictionary token; the
      // substring match must classify it the same as `partly_paid`.
      ['partial_payment', null, 'partially-paid'],
      ['sent', null, 'unpaid'],
      ['draft', null, 'unpaid'],
      ['printed', null, 'unpaid'],
      // A present paid_date with a non-paid status still resolves to paid.
      ['printed', '2026-07-05', 'paid'],
    ] as const)(
      'should map invoice status %s (paid_date=%s) to paymentStatus %s',
      async (status, paidDate, expected) => {
        const record = issuedRecord();
        http.seed(
          'GET',
          'invoices/inv-uuid-1.json',
          invoiceFixture({ status, paid_date: paidDate }),
        );

        const result = await adapter.getPaymentStatus(record);

        expect(result.paymentStatus).toBe(expected);
      },
    );

    it('should propagate a transport error (webhook body is never trusted)', async () => {
      const record = issuedRecord();
      http.seedError('GET', 'invoices/inv-uuid-1.json', new InfaktApiError('server error', 503, {}));

      await expect(adapter.getPaymentStatus(record)).rejects.toMatchObject({ statusCode: 503 });
    });
  });

  describe('markPaid (#1362)', () => {
    it('should POST the mark-paid task with the formatted date', async () => {
      http.seed('POST', 'async/invoices/inv-uuid-1/paid.json', {});

      await adapter.markPaid({
        externalInvoiceId: 'inv-uuid-1',
        paidDate: new Date('2026-07-08T12:34:56Z'),
      });

      expect(http.calls).toContainEqual({
        method: 'POST',
        path: 'async/invoices/inv-uuid-1/paid.json',
        body: { invoice: { paid_date: '2026-07-08' } },
      });
    });

    it('should carry no monetary value, hence no currency, on the mark-paid payload (#2103)', async () => {
      // `paid.json` settles the document in full against the currency the
      // document itself already carries - there is no amount here that could be
      // mis-denominated. Pinned so a future partial-payment amount cannot be
      // added without revisiting the currency question.
      http.seed('POST', 'async/invoices/inv-uuid-1/paid.json', {});

      await adapter.markPaid({
        externalInvoiceId: 'inv-uuid-1',
        paidDate: new Date('2026-07-08T12:34:56Z'),
      });

      const body = http.calls[0]?.body as { invoice: Record<string, unknown> };
      expect(Object.keys(body.invoice)).toEqual(['paid_date']);
    });

    it('should URL-encode the external invoice id', async () => {
      http.seed('POST', 'async/invoices/inv%2Fuuid/paid.json', {});

      await adapter.markPaid({
        externalInvoiceId: 'inv/uuid',
        paidDate: new Date('2026-07-08T00:00:00Z'),
      });

      expect(http.calls[0]?.path).toBe('async/invoices/inv%2Fuuid/paid.json');
    });

    it('should propagate a transport error', async () => {
      http.seedError(
        'POST',
        'async/invoices/inv-uuid-1/paid.json',
        new InfaktApiError('not found', 404, {}),
      );

      await expect(
        adapter.markPaid({ externalInvoiceId: 'inv-uuid-1', paidDate: new Date('2026-07-08') }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('resubmitForClearance (#1356)', () => {
    function issuedRecord(): InvoiceRecord {
      return new InvoiceRecord(
        'id-1',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'invoice',
        'issued',
        'inv-uuid-1',
        'FV/1/2026',
        'rejected',
        null,
        null,
        null,
        new Date(),
        null,
        new Date(),
        new Date(),
      );
    }

    it('re-hits send_to_ksef for the existing document and maps the returned status', async () => {
      http.seed(
        'POST',
        'invoices/inv-uuid-1/send_to_ksef.json',
        ksefResponseFixture({ status: 'sent' }),
      );

      const result = await adapter.resubmitForClearance(issuedRecord());

      expect(result).toEqual({ regulatoryStatus: 'submitted', clearanceReference: null });
      // Never re-POSTs invoices.json (no new draft) — only re-sends the SAME document.
      expect(http.calls.some((c) => c.method === 'POST' && c.path === 'invoices.json')).toBe(false);
      expect(
        http.calls.some(
          (c) => c.method === 'POST' && c.path === 'invoices/inv-uuid-1/send_to_ksef.json',
        ),
      ).toBe(true);
    });

    it('surfaces a KSeF number once the resend clears', async () => {
      http.seed(
        'POST',
        'invoices/inv-uuid-1/send_to_ksef.json',
        ksefResponseFixture({ status: 'success', ksef_number: 'KSeF-999' }),
      );

      const result = await adapter.resubmitForClearance(issuedRecord());

      expect(result).toEqual({ regulatoryStatus: 'accepted', clearanceReference: 'KSeF-999' });
    });

    it('returns not-applicable defensively when the record has no providerInvoiceId', async () => {
      const record = new InvoiceRecord(
        'id-1',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'invoice',
        'issued',
        null,
        null,
        'rejected',
        null,
        null,
        null,
        new Date(),
        null,
        new Date(),
        new Date(),
      );

      const result = await adapter.resubmitForClearance(record);

      expect(result).toEqual({ regulatoryStatus: 'not-applicable' });
    });

    it('propagates a transport error (error path)', async () => {
      http.seedError(
        'POST',
        'invoices/inv-uuid-1/send_to_ksef.json',
        new InfaktApiError('server error', 503, {}),
      );

      await expect(adapter.resubmitForClearance(issuedRecord())).rejects.toMatchObject({
        statusCode: 503,
      });
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

    /**
     * Seeds the three-call async correction flow (#1763): POST the task,
     * hydrate the resolved corrective invoice, kick its own KSeF submission.
     * `task` overrides let a test return the still-processing or failure
     * envelope from the POST instead.
     */
    function seedAsyncCorrection(
      task: Partial<InfaktAsyncTaskAccepted> = {},
      invoice: Partial<InfaktInvoice> = {},
    ): void {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seed('POST', 'async/corrective_invoices.json', asyncTaskFixture(task));
      http.seed(
        'GET',
        'corrective_invoices/corr-uuid-1.json',
        invoiceFixture({ uuid: 'corr-uuid-1', kind: 'correction', ...invoice }),
      );
      // A correction is its own KSeF document — needs its own send_to_ksef
      // kick through the corrective resource (invoices/… 404s for corrective
      // uuids; verified live, 2026-07-03).
      http.seed('POST', 'corrective_invoices/corr-uuid-1/send_to_ksef.json', ksefResponseFixture());
    }

    it('should POST to async/corrective_invoices.json and hydrate the resolved corrective invoice (happy path, #1763)', async () => {
      // The bare `corrective_invoices.json` path is NOT a real Infakt endpoint
      // — it 500s on every payload regardless of shape. The documented
      // creation flow is the async task endpoint (#1763), whose envelope
      // carries only `invoice_uuid`, so the full document must be hydrated
      // separately.
      seedAsyncCorrection({}, { corrected_invoice_number: 'FV/1/2026' });

      const { record } = await adapter.issueCorrection(baseCmd);

      expect(record).toBeInstanceOf(InvoiceRecord);
      expect(record.providerInvoiceId).toBe('corr-uuid-1');
      expect(record.idempotencyKey).toBe('idem-corr-1');
      expect(record.regulatoryStatus).toBe('submitted');

      expect(http.calls.some((c) => c.method === 'POST' && c.path === 'invoices.json')).toBe(false);
      // The pre-#1763 sync path must never be called again.
      expect(
        http.calls.some((c) => c.method === 'POST' && c.path === 'corrective_invoices.json'),
      ).toBe(false);
      expect(
        http.calls.some((c) => c.method === 'GET' && c.path === 'corrective_invoices/corr-uuid-1.json'),
      ).toBe(true);
      expect(
        http.calls.some(
          (c) => c.method === 'POST' && c.path === 'corrective_invoices/corr-uuid-1/send_to_ksef.json',
        ),
      ).toBe(true);
    });

    it('should denominate the correction in the corrected original currency (#2103)', async () => {
      // A correction must be booked in the same currency as the document it
      // corrects - and the before/after rows are built verbatim from that
      // document's own services, so the provider's value is the only correct
      // source. Omitting the field would fall back to the account default.
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture({ currency: 'EUR' }));
      http.seed('POST', 'async/corrective_invoices.json', asyncTaskFixture());
      http.seed(
        'GET',
        'corrective_invoices/corr-uuid-1.json',
        invoiceFixture({ uuid: 'corr-uuid-1', kind: 'correction', currency: 'EUR' }),
      );
      http.seed('POST', 'corrective_invoices/corr-uuid-1/send_to_ksef.json', ksefResponseFixture());

      await adapter.issueCorrection(baseCmd);

      const call = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json',
      );
      expect(call?.body).toMatchObject({
        corrective_invoice: expect.objectContaining({ currency: 'EUR' }),
      });
    });

    it("should warn but still use the provider's currency when OL's snapshot disagrees (#2103)", async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture({ currency: 'EUR' }));
      http.seed('POST', 'async/corrective_invoices.json', asyncTaskFixture());
      http.seed(
        'GET',
        'corrective_invoices/corr-uuid-1.json',
        invoiceFixture({ uuid: 'corr-uuid-1', kind: 'correction', currency: 'EUR' }),
      );
      http.seed('POST', 'corrective_invoices/corr-uuid-1/send_to_ksef.json', ksefResponseFixture());

      await adapter.issueCorrection({
        ...baseCmd,
        originalDocument: {
          buyer: buyer({ nip: '1234567890' }),
          currency: 'PLN',
          documentType: 'invoice',
          lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate: '23' }],
          clearanceReference: null,
          documentNumber: 'FV/1/2026',
          issueDate: '2026-07-01',
        },
      });

      const call = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json',
      );
      expect(call?.body).toMatchObject({
        corrective_invoice: expect.objectContaining({ currency: 'EUR' }),
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('PLN'));
    });

    it('should refuse to correct a document whose currency Infakt does not report, before any POST (#2103)', async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture({ currency: '' }));
      http.seed('POST', 'async/corrective_invoices.json', asyncTaskFixture());

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({ statusCode: 422 });
      expect(
        http.calls.some((c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json'),
      ).toBe(false);
    });

    it('should send corrected_invoice_uuid and a correction_reason SYMBOL, never the read-only correction_reason_symbol (#1763)', async () => {
      seedAsyncCorrection();

      await adapter.issueCorrection(baseCmd);

      const invoiceCall = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json',
      );
      // Verified live against the real Infakt v3 sandbox (2026-07-01):
      // omitting client_id on a corrective invoice 422s with "client_id
      // required" — the original invoice's own client_id must be forwarded.
      expect(invoiceCall?.body).toMatchObject({
        corrective_invoice: expect.objectContaining({
          client_id: 1,
          corrected_invoice_number: 'FV/1/2026',
          corrected_invoice_date: '2026-07-01',
          corrected_invoice_uuid: 'inv-uuid-1',
          // `correction_reason` is the WRITABLE field and takes a symbol from
          // Infakt's closed vocabulary — the operator's free-text
          // `cmd.reason` ('Zwrot towaru') is deliberately NOT forwarded.
          correction_reason: 'other',
        }),
      });
      const body = invoiceCall?.body as { corrective_invoice: Record<string, unknown> };
      expect('correction_reason_symbol' in body.corrective_invoice).toBe(false);
    });

    it('should poll the async status endpoint while the task is still processing (#1763)', async () => {
      // `processing_code: 100` = "Zlecenie przyjęte" (accepted, still
      // processing) — the POST response carries no invoice_uuid yet, so the
      // adapter must poll the status endpoint to a terminal state.
      //
      // Fake timers so the 2s poll interval is not actually slept through —
      // the unit suite's budget is ~2-3s in total (#1899 review).
      jest.useFakeTimers();
      try {
        seedAsyncCorrection({ processing_code: 100, processing_description: 'Zlecenie przyjęte' });
        http.seed('GET', 'async/corrective_invoices/status/task-ref-1.json', asyncTaskFixture());

        const pending = adapter.issueCorrection(baseCmd);
        await jest.advanceTimersByTimeAsync(2000);
        const { record } = await pending;

        expect(
          http.calls.some(
            (c) =>
              c.method === 'GET' && c.path === 'async/corrective_invoices/status/task-ref-1.json',
          ),
        ).toBe(true);
        expect(record.providerInvoiceId).toBe('corr-uuid-1');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should classify a 4xx terminal processing_code as failureMode: rejected (#1763)', async () => {
      // Verified live (2026-07-29): an invalid payload resolves to
      // `{processing_code: 422, processing_description: "Nie udało się
      // stworzyć faktury"}` with NO invoice_uuid — the provider
      // deterministically created nothing, so this is the re-attemptable
      // `'rejected'` class. Collapsing it to 502 would make it `'in-doubt'`
      // and park the record for manual reconciliation instead.
      seedAsyncCorrection({
        processing_code: 422,
        processing_description: 'Nie udało się stworzyć faktury',
        invoice_uuid: undefined,
      });

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({
        name: 'InfaktApiError',
        statusCode: 422,
        failureMode: 'rejected',
      });
      // Nothing was created — never hydrate, never submit to KSeF.
      expect(
        http.calls.some((c) => c.method === 'GET' && c.path === 'corrective_invoices/corr-uuid-1.json'),
      ).toBe(false);
      expect(http.calls.some((c) => c.path.endsWith('send_to_ksef.json'))).toBe(false);
    });

    it('should classify an unknown terminal processing_code as failureMode: in-doubt (#1763)', async () => {
      // A non-4xx terminal code with no invoice_uuid is indeterminate — a
      // document MAY exist, so core must not auto-re-attempt.
      seedAsyncCorrection({
        processing_code: 500,
        processing_description: 'Błąd serwera',
        invoice_uuid: undefined,
      });

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({
        statusCode: 502,
        failureMode: 'in-doubt',
      });
    });

    it('should reject a task envelope resolved for a different invoice kind (#1337 precedent)', async () => {
      // Belt-and-suspenders for the silent-downgrade class of bug: a task
      // envelope naming a non-corrective resource must never be hydrated and
      // persisted as a correction.
      seedAsyncCorrection({ invoice_kind: 'vat' });

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({
        name: 'InfaktApiError',
      });
      expect(http.calls.some((c) => c.path.endsWith('send_to_ksef.json'))).toBe(false);
    });

    it('should reject a line number that does not exist on the original invoice, before any POST (#1899 review)', async () => {
      // An out-of-range line number matches no original row, so every group
      // would emit an identical before/after pair and Infakt would mint a
      // real 0.00 PLN corrective document (reproduced live 2026-07-29:
      // `originalLineNumber: 99` produced `3/KOR/07/2026`, gross 0, and it
      // was submitted to KSeF). Nothing crossed the boundary, so `rejected`.
      seedAsyncCorrection();

      await expect(
        adapter.issueCorrection({
          ...baseCmd,
          lines: [{ originalLineNumber: 99, newUnitPriceGross: 1 }],
        }),
      ).rejects.toMatchObject({
        name: 'InfaktApiError',
        statusCode: 422,
        failureMode: 'rejected',
      });
      expect(
        http.calls.some((c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json'),
      ).toBe(false);
    });

    it('should reject a duplicated line number, before any POST (#1899 review)', async () => {
      // Two corrected rows for one group leaves the group's before/after
      // pairing — what Infakt computes the delta from — undefined. Same
      // pre-POST 422 / `rejected` class as the out-of-range guard.
      seedAsyncCorrection();

      await expect(
        adapter.issueCorrection({
          ...baseCmd,
          lines: [
            { originalLineNumber: 1, newUnitPriceGross: 10 },
            { originalLineNumber: 1, newUnitPriceGross: 20 },
          ],
        }),
      ).rejects.toMatchObject({
        name: 'InfaktApiError',
        statusCode: 422,
        failureMode: 'rejected',
      });
      expect(
        http.calls.some((c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json'),
      ).toBe(false);
    });

    it('should reject a hydrated document whose kind is not a correction (#1337 guard, #1899 review)', async () => {
      // The task envelope's `invoice_kind` names the REQUESTED resource, so it
      // cannot catch the provider silently minting a plain VAT invoice from a
      // correction payload (the original #1337 defect, verified live
      // 2026-07-03). The created document's own `kind` is the only field that
      // can. 502 → `in-doubt`: a document DOES exist, so core must not
      // auto-re-attempt and mint a second one.
      seedAsyncCorrection({}, { kind: 'vat' });

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({
        name: 'InfaktApiError',
        statusCode: 502,
        failureMode: 'in-doubt',
      });
      expect(http.calls.some((c) => c.path.endsWith('send_to_ksef.json'))).toBe(false);
    });

    it('should warn that the operator free-text reason is discarded (#1899 review)', async () => {
      // Infakt's correction_reason takes a closed symbol vocabulary, so
      // cmd.reason cannot be forwarded — the loss must at least be observable.
      seedAsyncCorrection();

      await adapter.issueCorrection(baseCmd);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Zwrot towaru'));
    });

    it('should not warn when no correction reason was supplied (#1899 review)', async () => {
      seedAsyncCorrection();

      await adapter.issueCorrection({ ...baseCmd, reason: undefined });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should send integer-groszy unit_net_price and numeric quantity, paired per string group (#1763)', async () => {
      // Same plain-integer-groszy / numeric-quantity shape as
      // async/invoices.json — live-verified 2026-07-29. baseCmd's line
      // carries no newUnitPriceGross, so both the "before" row and the
      // fallback "after" row carry the original's 10000 groszy net.
      seedAsyncCorrection();

      await adapter.issueCorrection(baseCmd);

      const postCall = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json',
      );
      const body = postCall?.body as {
        corrective_invoice: {
          services: { unit_net_price: number; quantity: number; group: string; correction: boolean }[];
        };
      };
      const beforeRow = body.corrective_invoice.services.find((s) => s.correction === false);
      const afterRow = body.corrective_invoice.services.find((s) => s.correction === true);
      expect(beforeRow).toMatchObject({ unit_net_price: 10000, quantity: 1, group: '1' });
      // baseCmd zeroes the line's quantity (newQuantity: 0).
      expect(afterRow).toMatchObject({ unit_net_price: 10000, quantity: 0, group: '1' });
    });

    it('should convert a price-changing correction line from gross to net groszy (#1292 review)', async () => {
      seedAsyncCorrection();

      await adapter.issueCorrection({
        ...baseCmd,
        lines: [{ originalLineNumber: 1, newUnitPriceGross: 61.5 }],
      });

      const postCall = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json',
      );
      const body = postCall?.body as {
        corrective_invoice: { services: { unit_net_price: number; correction: boolean }[] };
      };
      const correctedRow = body.corrective_invoice.services.find((s) => s.correction === true);
      // 61.5 gross / 1.23 (tax_symbol '23') = 50.00 net = 5000 groszy.
      expect(correctedRow?.unit_net_price).toBe(5000);
    });

    it('should honour a correction to 0.00 PLN instead of falling back to the original price (#1342 review)', async () => {
      seedAsyncCorrection();

      await adapter.issueCorrection({
        ...baseCmd,
        lines: [{ originalLineNumber: 1, newUnitPriceGross: 0 }],
      });

      const postCall = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json',
      );
      const body = postCall?.body as {
        corrective_invoice: { services: { unit_net_price: number; correction: boolean }[] };
      };
      const correctedRow = body.corrective_invoice.services.find((s) => s.correction === true);
      expect(correctedRow?.unit_net_price).toBe(0);
    });

    it('should propagate a 422 InfaktApiError with failureMode: rejected (error path)', async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seedError(
        'POST',
        'async/corrective_invoices.json',
        new InfaktApiError('Infakt rejected the correction', 422, { error: 'bad correction' }),
      );

      await expect(adapter.issueCorrection(baseCmd)).rejects.toMatchObject({
        failureMode: 'rejected',
        statusCode: 422,
      });
    });

    it('should propagate a 500 InfaktApiError with failureMode: in-doubt (error path)', async () => {
      http.seed('GET', 'invoices/inv-uuid-1.json', invoiceFixture());
      http.seedError(
        'POST',
        'async/corrective_invoices.json',
        new InfaktApiError('server error', 500, {}),
      );

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
      seedAsyncCorrection();
      http.seedError(
        'POST',
        'corrective_invoices/corr-uuid-1/send_to_ksef.json',
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

    it('should fetch a corrected record PDF via the corrective_invoices resource (#1337)', async () => {
      const now = new Date('2026-07-03T12:00:00Z');
      const record = new InvoiceRecord(
        'record-2',
        'conn-1',
        'order-1',
        INFAKT_PROVIDER_TYPE,
        'corrected',
        'issued',
        'corr-uuid-1',
        'FK/1/2026',
        'accepted',
        'ksef-number-2',
        'idem-corr-1',
        null,
        now,
        null,
        now,
        now,
      );
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      http.seedBinary('corrective_invoices/corr-uuid-1/pdf.json', {
        data: pdfBytes,
        contentType: 'application/pdf',
      });

      const document = await adapter.getRegulatoryDocument(record, 'rendered');

      expect(document.content).toBe(pdfBytes);
      const call = http.calls.find(
        (c) => c.method === 'GET_BINARY' && c.path === 'corrective_invoices/corr-uuid-1/pdf.json',
      );
      expect(call?.query).toEqual({ document_type: 'original' });
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
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([]));
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
      // corrections go through the documented ASYNC corrective task endpoint
      // (#1763), then the resolved document is hydrated by uuid
      http.seed('POST', 'async/corrective_invoices.json', asyncTaskFixture());
      http.seed(
        'GET',
        'corrective_invoices/corr-uuid-1.json',
        invoiceFixture({ uuid: 'corr-uuid-1', kind: 'correction' }),
      );
      // a correction is its own KSeF document - issueCorrection submits it inline
      http.seed('POST', 'corrective_invoices/corr-uuid-1/send_to_ksef.json', ksefResponseFixture());
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

      const invoiceCall = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json',
      );
      expect(invoiceCall?.body).toMatchObject({
        corrective_invoice: expect.objectContaining({ payment_method: 'cash' }),
      });
    });

    it('should use the same configured defaultPaymentMethod on issueCorrection as issueInvoice (no more disagreement)', async () => {
      const configured = new InfaktInvoicingAdapter('conn-1', http, logger, {
        defaultPaymentMethod: 'transfer',
      });
      seedCorrectionFixtures();
      await configured.issueCorrection(correctionCmd);

      const invoiceCall = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'async/corrective_invoices.json',
      );
      expect(invoiceCall?.body).toMatchObject({
        corrective_invoice: expect.objectContaining({ payment_method: 'transfer' }),
      });
    });
  });

  describe('bank accounts (#1303 follow-up)', () => {
    // Seeded from the real `GET /bank_accounts.json` capture, so the mapping is
    // asserted against the envelope inFakt actually emits (#1926).
    it('should map the bank-accounts list from snake_case to camelCase, including the default flag', async () => {
      http.seed<InfaktListResponse<InfaktBankAccount>>(
        'GET',
        'bank_accounts.json',
        BANK_ACCOUNTS_CAPTURE,
      );

      const accounts = await adapter.listBankAccounts();

      expect(accounts).toEqual(
        BANK_ACCOUNTS_CAPTURE.entities.map((account) => ({
          id: String(account.id),
          accountNumber: account.account_number,
          bankName: account.bank_name,
          isDefault: account.default,
        })),
      );
      // Pin the captured values so a fixture refresh can't silently empty this.
      expect(accounts).toHaveLength(2);
      expect(accounts.filter((account) => account.isDefault)).toHaveLength(1);
    });

    it('should return an empty array when inFakt has no bank accounts configured', async () => {
      http.seed<InfaktListResponse<unknown>>('GET', 'bank_accounts.json', listResponse([]));

      await expect(adapter.listBankAccounts()).resolves.toEqual([]);
    });

    // #1373/#1374/#1926 regression guard. Retargeted at the REAL key: the
    // previous version of this test asserted that `{ entities, metainfo }` — the
    // shape inFakt actually returns — had to be rejected, which is why the suite
    // stayed green while every live call 502'd.
    it('should throw a named InfaktApiError instead of an undefined.map() TypeError when the list envelope carries no entities array', async () => {
      http.seed('GET', 'bank_accounts.json', {
        items: [],
        pagination: { current_page: 1, items_on_page: 0, limit: 10, total_items: 0, total_pages: 1 },
      });

      await expect(adapter.listBankAccounts()).rejects.toThrow(InfaktApiError);
      await expect(adapter.listBankAccounts()).rejects.toThrow(/unexpected envelope shape/);
    });

    it('should accept the real captured envelope rather than rejecting it', async () => {
      http.seed('GET', 'bank_accounts.json', BANK_ACCOUNTS_CAPTURE);

      await expect(adapter.listBankAccounts()).resolves.toHaveLength(2);
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
      http.seed<InfaktListResponse<InfaktClient>>('GET', 'clients.json', listResponse([]));
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
      http.seed('POST', 'invoices/inv-uuid-1/send_to_ksef.json', ksefResponseFixture());
    }

    it('should attach bank_account/bank_name when transfer and a bank account are configured', async () => {
      const configured = new InfaktInvoicingAdapter('conn-1', http, logger, {
        defaultPaymentMethod: 'transfer',
        bankAccount: { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank' },
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
        bankAccount: { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank' },
      });
      seedIssueFixtures();
      await configured.issueInvoice(invoiceCmd);

      const invoiceCall = http.calls.find((c) => c.method === 'POST' && c.path === 'invoices.json');
      const body = invoiceCall?.body as { invoice: Record<string, unknown> };
      expect(body.invoice.bank_account).toBeUndefined();
      expect(body.invoice.bank_name).toBeUndefined();
    });
  });

  describe('sendByEmail (#1353)', () => {
    it('should POST deliver_via_email with print_type, mapped locale and send_copy', async () => {
      http.seed('POST', 'invoices/inv-uuid-1/deliver_via_email.json', {});

      const result = await adapter.sendByEmail({
        externalInvoiceId: 'inv-uuid-1',
        locale: 'en',
        sendCopy: true,
      });

      const call = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'invoices/inv-uuid-1/deliver_via_email.json',
      );
      expect(call?.body).toEqual({
        print_type: 'original',
        locale: 'en',
        send_copy: true,
      });
      expect(result).toEqual({ delivered: true, recipient: null });
    });

    it('should omit locale/send_copy when not provided (inFakt defaults apply)', async () => {
      http.seed('POST', 'invoices/inv-uuid-1/deliver_via_email.json', {});

      const result = await adapter.sendByEmail({ externalInvoiceId: 'inv-uuid-1' });

      const call = http.calls.find(
        (c) => c.method === 'POST' && c.path === 'invoices/inv-uuid-1/deliver_via_email.json',
      );
      expect(call?.body).toEqual({ print_type: 'original' });
      expect(result).toEqual({ delivered: true, recipient: null });
    });

    it('should propagate a provider rejection', async () => {
      http.seedError(
        'POST',
        'invoices/inv-uuid-1/deliver_via_email.json',
        new InfaktApiError('deliver failed', 422, { error: 'delivery rejected' }),
      );

      await expect(adapter.sendByEmail({ externalInvoiceId: 'inv-uuid-1' })).rejects.toBeInstanceOf(
        InfaktApiError,
      );
    });
  });
});
