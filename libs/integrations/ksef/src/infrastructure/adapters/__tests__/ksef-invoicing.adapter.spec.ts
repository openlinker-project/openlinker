/**
 * KSeF invoicing adapter specs — online-session issuance, neutral result purity,
 * zero-valid terminal-failure (count-based), document-type discovery, and the
 * RegulatoryTransmitter guard. The HTTP client + session crypto are mocked — no
 * network, no real crypto.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import {
  isCorrectionIssuer,
  isDocumentNumberConsumer,
  isOfflineResubmitter,
  isRegulatoryDocumentReader,
  isRegulatoryRecordLocator,
  isRegulatoryTransmitter,
  UnsupportedRegulatoryDocumentKindError,
} from '@openlinker/core/invoicing';
import type {
  BuyerProfile as BuyerProfileType,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  OriginalDocumentSnapshot,
  StoredDocument,
} from '@openlinker/core/invoicing';
import { BuyerProfile } from '@openlinker/core/invoicing';
import { KsefInvoicingAdapter } from '../ksef-invoicing.adapter';
import { KsefSessionException } from '../../../domain/exceptions/ksef-session.exception';
import { KsefNetworkException } from '../../../domain/exceptions/ksef-network.exception';
import { KsefApiException } from '../../../domain/exceptions/ksef-api.exception';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import { KsefUnsupportedDocumentTypeException } from '../../../domain/exceptions/ksef-unsupported-document-type.exception';
import { KsefInvalidCorrectionException } from '../../../domain/exceptions/ksef-invalid-correction.exception';
import { KsefMissingDocumentNumberException } from '../../../domain/exceptions/ksef-missing-document-number.exception';
import { FakeKsefHttpClient } from '../../../testing/fake-ksef-http-client';
import type { KsefSessionCryptoService } from '../../crypto/ksef-session-crypto.service';
import type { SessionCryptoContext, EncryptedDocument } from '../../http/ksef-crypto.types';
import type { IFa3XmlBuilder } from '../../fa3/builders/fa3-xml-builder.port';
import type {
  Fa3BuilderInput,
  Fa3PaymentInput,
  RawFa3Xml,
  SellerProfile,
} from '../../fa3/domain/fa3-xml.types';

const SELLER: SellerProfile = {
  nip: '1234567890',
  name: 'Acme Sp. z o.o.',
  address: {
    line1: 'ul. Testowa 1',
    line2: null,
    city: 'Warszawa',
    postalCode: '00-001',
    countryIso2: 'PL',
  },
};

const DEFAULT_TAX_RATE = '23';

const SESSION_REF = 'SESSION-REF-001';
const INVOICE_REF = 'INVOICE-REF-001';

function buyer(): BuyerProfileType {
  return new BuyerProfile(
    'Klient Sp. z o.o.',
    { scheme: 'pl-nip', value: '9876543210' },
    { line1: 'ul. Kupiecka 2', line2: null, city: 'Kraków', postalCode: '30-001', countryIso2: 'PL' },
    'company',
  );
}

function command(overrides: Partial<IssueInvoiceCommand> = {}): IssueInvoiceCommand {
  return {
    connectionId: 'conn-1',
    orderId: 'ol_order_123',
    buyer: buyer(),
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 123.0, taxRate: '23' }],
    // KSeF is a DocumentNumberConsumer (#1575): the core InvoiceService allocates
    // the FA(3) P_2 and passes it as documentNumber. The adapter consumes it.
    documentNumber: 'FV/2026/06/0001',
    ...overrides,
  };
}

/** A fake build pipeline that yields a fixed, branded XML string (no real XSD run). */
const fakeBuilder: IFa3XmlBuilder = {
  build(_input: Fa3BuilderInput): RawFa3Xml {
    return '<Faktura>fake</Faktura>' as RawFa3Xml;
  },
};

/**
 * A capturing build pipeline — records the last `Fa3BuilderInput` it received so a
 * test can assert the adapter mapped the neutral correction into a KOR input.
 */
function capturingBuilder(): { builder: IFa3XmlBuilder; lastInput: () => Fa3BuilderInput | null } {
  let captured: Fa3BuilderInput | null = null;
  return {
    builder: {
      build(input: Fa3BuilderInput): RawFa3Xml {
        captured = input;
        return '<Faktura>fake</Faktura>' as RawFa3Xml;
      },
    },
    lastInput: () => captured,
  };
}

/** Minimal session-crypto double: deterministic context + passthrough encrypt. */
function fakeCrypto(): KsefSessionCryptoService {
  const context: SessionCryptoContext = {
    symmetricKey: { key: new Uint8Array(32), iv: new Uint8Array(16) },
    wrappedKey: { wrappedKey: new Uint8Array([1, 2, 3]), certificateHash: 'hash' },
    expiresAt: new Date(Date.now() + 60_000),
  };
  const encrypted: EncryptedDocument = {
    algorithm: 'aes-256-cbc',
    ciphertext: new Uint8Array([9, 9, 9, 9]),
    iv: new Uint8Array(16),
  };
  return {
    initializeSession: jest.fn().mockResolvedValue(context),
    encryptDocument: jest.fn().mockReturnValue(encrypted),
    decryptDocument: jest.fn(),
  } as unknown as KsefSessionCryptoService;
}

function seedHappyPath(
  http: FakeKsefHttpClient,
  sessionStatus: { code?: number; successfulInvoiceCount?: number; failedInvoiceCount?: number } = {
    code: 200,
    successfulInvoiceCount: 1,
    failedInvoiceCount: 0,
  },
): void {
  http
    .seed('POST', '/sessions/online', {
      data: { referenceNumber: SESSION_REF },
      status: 201,
      headers: {},
    })
    .seed('POST', `/sessions/online/${SESSION_REF}/invoices`, {
      data: { referenceNumber: INVOICE_REF },
      status: 202,
      headers: {},
    })
    .seed('POST', `/sessions/online/${SESSION_REF}/close`, {
      data: {},
      status: 200,
      headers: {},
    })
    .seed('GET', `/sessions/${SESSION_REF}`, {
      data: {
        status: { code: sessionStatus.code },
        successfulInvoiceCount: sessionStatus.successfulInvoiceCount,
        failedInvoiceCount: sessionStatus.failedInvoiceCount,
      },
      status: 200,
      headers: {},
    });
}

function originalDocument(overrides: Partial<OriginalDocumentSnapshot> = {}): OriginalDocumentSnapshot {
  return {
    buyer: buyer(),
    currency: 'PLN',
    documentType: 'invoice',
    lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 123.0, taxRate: '23' }],
    clearanceReference: '1111111111-20260501-ABCDEF-01',
    documentNumber: 'FV/2026/05/0042',
    issueDate: '2026-05-01',
    ...overrides,
  };
}

function correctionCommand(overrides: Partial<IssueCorrectionCommand> = {}): IssueCorrectionCommand {
  return {
    connectionId: 'conn-1',
    orderId: 'ol_order_123',
    originalProviderInvoiceId: `${SESSION_REF}:${INVOICE_REF}`,
    reason: 'Customer returned 1 unit',
    lines: [{ originalLineNumber: 1, newQuantity: 1 }],
    originalDocument: originalDocument(),
    // The correction's own P_2, allocated upstream from the correction series
    // (#1575) — distinct from the original document's number by construction.
    documentNumber: 'FK/2026/06/0001',
    ...overrides,
  };
}

function adapter(
  http: FakeKsefHttpClient,
  builder: IFa3XmlBuilder = fakeBuilder,
  payment?: Fa3PaymentInput,
): KsefInvoicingAdapter {
  return new KsefInvoicingAdapter(
    'conn-1',
    http,
    fakeCrypto(),
    builder,
    SELLER,
    DEFAULT_TAX_RATE,
    { payment, now: () => new Date('2026-06-23T10:00:00.000Z') },
  );
}

/**
 * A `FakeKsefHttpClient` that can be told to reject a specific `METHOD path`
 * with a chosen error (e.g. a `KsefNetworkException` to simulate a KSeF outage),
 * delegating every other call to the seeded happy-path behaviour. Records the
 * failing call so tests can assert the surrounding flow (e.g. best-effort close).
 */
class OutageKsefHttpClient extends FakeKsefHttpClient {
  private readonly failures = new Map<string, Error>();

  failOn(method: 'GET' | 'POST', path: string, error: Error): this {
    this.failures.set(`${method} ${path}`, error);
    return this;
  }

  override post<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: Parameters<FakeKsefHttpClient['post']>[2],
  ): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const failure = this.failures.get(`POST ${path}`);
    if (failure) {
      this.calls.push({ method: 'POST', path, body, options });
      return Promise.reject(failure);
    }
    return super.post<T>(path, body, options);
  }
}

const SOURCE_XML = '<Faktura>offline</Faktura>';

/** An offline (`pending-submission`) record carrying the persisted FA(3) source XML. */
function offlineRecord(sourceDocument: StoredDocument | null = {
  contentType: 'application/xml',
  contentBase64: Buffer.from(SOURCE_XML, 'utf-8').toString('base64'),
}): InvoiceRecord {
  return new InvoiceRecord(
    'rec-offline',
    'conn-1',
    'ol_order_123',
    'ksef',
    'invoice',
    'issued',
    null, // no providerInvoiceId — nothing landed at issue time
    'FV/2026/06/0001',
    'pending-submission',
    null,
    null,
    null,
    new Date('2026-06-23T10:00:00.000Z'),
    null,
    new Date('2026-06-23T10:00:00.000Z'),
    new Date('2026-06-23T10:00:00.000Z'),
    null, // failureMode
    null, // failureCode
    null, // failureReason
    null, // leaseExpiresAt
    false, // hasBuyerTaxId
    null, // documentContent
    sourceDocument,
  );
}

describe('KsefInvoicingAdapter', () => {
  describe('issueInvoice', () => {
    it('should issue a VAT invoice end-to-end and return a submitted neutral record', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      const { record, seller, sourceDocument } = await adapter(http).issueInvoice(command());

      // The adapter surfaces the neutral seller block (scheme-tagged tax id) so
      // the core InvoiceService can snapshot the issued-document content.
      expect(seller).toEqual({
        name: 'Acme Sp. z o.o.',
        taxId: { scheme: 'pl-nip', value: '1234567890' },
        address: SELLER.address,
      });

      // The built FA(3) XML rides back as a neutral base64 source document so core
      // persists it for `GET .../document?kind=source` (#1224 W3).
      expect(sourceDocument).toEqual({
        contentType: 'application/xml',
        contentBase64: Buffer.from('<Faktura>fake</Faktura>', 'utf-8').toString('base64'),
      });

      expect(record.providerInvoiceId).toBe(`${SESSION_REF}:${INVOICE_REF}`);
      // The FA(3) P_2 is the core-allocated documentNumber (#1575), landed on the
      // record as providerInvoiceNumber (single source, #1338).
      expect(record.providerInvoiceNumber).toBe('FV/2026/06/0001');
      expect(record.regulatoryStatus).toBe('submitted');
      expect(record.clearanceReference).toBeNull();
      expect(record.status).toBe('issued');
      expect(record.providerType).toBe('ksef');
      expect(record.connectionId).toBe('conn-1');
      expect(record.orderId).toBe('ol_order_123');

      const paths = http.calls.map((c) => `${c.method} ${c.path}`);
      expect(paths).toEqual([
        'POST /sessions/online',
        `POST /sessions/online/${SESSION_REF}/invoices`,
        `POST /sessions/online/${SESSION_REF}/close`,
        `GET /sessions/${SESSION_REF}`,
      ]);
    });

    it('should pass the resolved payment config through to the builder input (#1311)', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);
      const { builder, lastInput } = capturingBuilder();
      const payment: Fa3PaymentInput = { formaPlatnosci: '6', paymentTermDays: 14 };

      await adapter(http, builder, payment).issueInvoice(command());

      expect(lastInput()?.payment).toEqual(payment);
    });

    it('should not set payment on the builder input when the adapter has none configured', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);
      const { builder, lastInput } = capturingBuilder();

      await adapter(http, builder).issueInvoice(command());

      expect(lastInput()?.payment).toBeUndefined();
    });

    it('should send the wrapped key + IV and both content hashes on submit', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      await adapter(http).issueInvoice(command());

      const open = http.calls.find((c) => c.path === '/sessions/online');
      const openBody = open?.body as { encryption: { encryptedSymmetricKey: string; initializationVector: string } };
      expect(openBody.encryption.encryptedSymmetricKey).toBe(Buffer.from([1, 2, 3]).toString('base64'));
      expect(openBody.encryption.initializationVector).toBe(Buffer.from(new Uint8Array(16)).toString('base64'));

      const submit = http.calls.find((c) => c.path.endsWith('/invoices'));
      const submitBody = submit?.body as { invoiceHash: string; encryptedInvoiceHash: string; encryptedInvoiceContent: string };
      expect(submitBody.invoiceHash).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(submitBody.encryptedInvoiceHash).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(submitBody.encryptedInvoiceContent).toBe(Buffer.from([9, 9, 9, 9]).toString('base64'));
    });

    it('should throw KsefSessionException (not succeed) when a processed session cleared zero invoices', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http, { code: 200, successfulInvoiceCount: 0, failedInvoiceCount: 1 });

      await expect(adapter(http).issueInvoice(command())).rejects.toBeInstanceOf(KsefSessionException);
    });

    it('should terminally reject an unsupported document type before any network call', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      await expect(
        adapter(http).issueInvoice(command({ documentType: 'proforma' })),
      ).rejects.toBeInstanceOf(KsefUnsupportedDocumentTypeException);
      // Rejected up front — no session is opened.
      expect(http.calls).toHaveLength(0);
    });

    it('should issue when documentType is a supported type', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      // 'invoice' is supported and needs no correction payload.
      const { record } = await adapter(http).issueInvoice(command({ documentType: 'invoice' }));
      expect(record.documentType).toBe('invoice');
    });

    it('should terminally reject documentType:corrected with no correction payload', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      await expect(
        adapter(http).issueInvoice(command({ documentType: 'corrected' })),
      ).rejects.toBeInstanceOf(KsefInvalidCorrectionException);
      // Rejected up front — no session is opened.
      expect(http.calls).toHaveLength(0);
    });

    it('should terminally reject a correction payload without documentType:corrected', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      await expect(
        adapter(http).issueInvoice(
          command({
            // documentType omitted (defaults to a plain invoice) but a correction
            // payload is supplied → inconsistent command.
            correction: {
              originalClearanceReference: '1111111111-20260501-ABCDEF-01',
              originalDocumentNumber: 'FV/2026/05/0042',
              originalIssueDate: '2026-05-01',
              reason: 'Customer returned 1 unit',
              correctedLines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123.0, taxRate: '23' }],
            },
          }),
        ),
      ).rejects.toBeInstanceOf(KsefInvalidCorrectionException);
      expect(http.calls).toHaveLength(0);
    });

    it('should still close the session when submit fails', async () => {
      const http = new FakeKsefHttpClient();
      // Open succeeds; invoices POST is not seeded → submit rejects.
      http
        .seed('POST', '/sessions/online', { data: { referenceNumber: SESSION_REF }, status: 201, headers: {} })
        .seed('POST', `/sessions/online/${SESSION_REF}/close`, { data: {}, status: 200, headers: {} });

      await expect(adapter(http).issueInvoice(command())).rejects.toBeDefined();
      const paths = http.calls.map((c) => `${c.method} ${c.path}`);
      expect(paths).toContain(`POST /sessions/online/${SESSION_REF}/close`);
    });

    it('should propagate the SUBMIT error (not the close error) when both submit and close fail', async () => {
      const http = new FakeKsefHttpClient();
      // Open succeeds; neither invoices POST nor close is seeded → both reject.
      // The submit failure is the actionable one and must win over the close failure.
      http.seed('POST', '/sessions/online', {
        data: { referenceNumber: SESSION_REF },
        status: 201,
        headers: {},
      });

      await expect(adapter(http).issueInvoice(command())).rejects.toThrow(
        new RegExp(`/sessions/online/${SESSION_REF}/invoices`),
      );
      const paths = http.calls.map((c) => `${c.method} ${c.path}`);
      // The close was still attempted (best-effort) even though it also failed.
      expect(paths).toContain(`POST /sessions/online/${SESSION_REF}/close`);
    });

    it('should propagate the CLOSE error when submit succeeds but close fails', async () => {
      const http = new FakeKsefHttpClient();
      // Open + submit succeed; close is not seeded → close rejects. With a
      // successful submit, the close failure is the real (and only) error.
      http
        .seed('POST', '/sessions/online', { data: { referenceNumber: SESSION_REF }, status: 201, headers: {} })
        .seed('POST', `/sessions/online/${SESSION_REF}/invoices`, {
          data: { referenceNumber: INVOICE_REF },
          status: 202,
          headers: {},
        });

      await expect(adapter(http).issueInvoice(command())).rejects.toThrow(
        new RegExp(`/sessions/online/${SESSION_REF}/close`),
      );
    });

    it('should return a neutral result carrying no ksef/upo/fa strings', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      const { record } = await adapter(http).issueInvoice(command());
      // providerType is the neutral open string 'ksef' (the only allowed mention,
      // and it lives on the provider-type axis, not a leaked status/number).
      const serialized = JSON.stringify({
        documentType: record.documentType,
        status: record.status,
        regulatoryStatus: record.regulatoryStatus,
        clearanceReference: record.clearanceReference,
        providerInvoiceId: record.providerInvoiceId,
        providerInvoiceNumber: record.providerInvoiceNumber,
      });
      expect(serialized.toLowerCase()).not.toContain('upo');
      expect(serialized.toLowerCase()).not.toContain('faktura');
      expect(serialized.toLowerCase()).not.toContain('nip');
    });

    it('should route a documentType:corrected command through the send flow and map it to a KOR input', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);
      const { builder, lastInput } = capturingBuilder();

      const { record } = await adapter(http, builder).issueInvoice(
        command({
          documentType: 'corrected',
          correction: {
            originalClearanceReference: '1111111111-20260501-ABCDEF-01',
            originalDocumentNumber: 'FV/2026/05/0042',
            originalIssueDate: '2026-05-01',
            reason: 'Customer returned 1 unit',
            correctedLines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123.0, taxRate: '23' }],
          },
        }),
      );

      // Same C5 session-send sequence as a plain invoice.
      const paths = http.calls.map((c) => `${c.method} ${c.path}`);
      expect(paths).toEqual([
        'POST /sessions/online',
        `POST /sessions/online/${SESSION_REF}/invoices`,
        `POST /sessions/online/${SESSION_REF}/close`,
        `GET /sessions/${SESSION_REF}`,
      ]);

      // Neutral result keeps the corrected document type + submitted status.
      expect(record.documentType).toBe('corrected');
      expect(record.regulatoryStatus).toBe('submitted');
      expect(record.providerInvoiceId).toBe(`${SESSION_REF}:${INVOICE_REF}`);

      // The adapter mapped the neutral correction into a fully-mapped KOR input.
      const built = lastInput();
      expect(built?.correction).toBeDefined();
      expect(built?.correction?.typKorekty).toBe('2');
      expect(built?.correction?.originalKsefNumber).toBe('1111111111-20260501-ABCDEF-01');
      expect(built?.correction?.originalInvoiceNumber).toBe('FV/2026/05/0042');
      expect(built?.correction?.correctedLines).toHaveLength(1);
    });

    it('should map a correction of a non-KSeF original to a null originalKsefNumber (NrKSeFN path)', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);
      const { builder, lastInput } = capturingBuilder();

      await adapter(http, builder).issueInvoice(
        command({
          documentType: 'corrected',
          correction: {
            originalClearanceReference: null,
            originalDocumentNumber: 'PAPER/2026/05/9',
            originalIssueDate: '2026-05-01',
            reason: 'Refund',
            correctedLines: [{ name: 'Widget', quantity: 0, unitPriceGross: 123.0, taxRate: '23' }],
          },
        }),
      );

      expect(lastInput()?.correction?.originalKsefNumber).toBeNull();
    });

    it('should throw terminally when no documentNumber was allocated (#1575)', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      await expect(
        adapter(http).issueInvoice(command({ documentNumber: undefined })),
      ).rejects.toBeInstanceOf(KsefMissingDocumentNumberException);
      // Fails before any session/XML work — the provider is never contacted.
      expect(http.calls).toHaveLength(0);
    });

    it('should consume the core-allocated documentNumber as the FA(3) P_2 (#1575)', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);
      const { builder, lastInput } = capturingBuilder();

      await adapter(http, builder).issueInvoice(command({ documentNumber: 'FV/2026/07/0123' }));

      expect(lastInput()?.invoiceNumber).toBe('FV/2026/07/0123');
    });
  });

  describe('issueCorrection (#1288)', () => {
    it('should be exposed as CorrectionIssuer', () => {
      expect(isCorrectionIssuer(adapter(new FakeKsefHttpClient()))).toBe(true);
    });

    it('should be exposed as DocumentNumberConsumer (#1575)', () => {
      expect(isDocumentNumberConsumer(adapter(new FakeKsefHttpClient()))).toBe(true);
    });

    it('should delegate into the issueInvoice KOR path and submit a corrected document', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);
      const { builder, lastInput } = capturingBuilder();

      const { record } = await adapter(http, builder).issueCorrection(correctionCommand());

      const paths = http.calls.map((c) => `${c.method} ${c.path}`);
      expect(paths).toEqual([
        'POST /sessions/online',
        `POST /sessions/online/${SESSION_REF}/invoices`,
        `POST /sessions/online/${SESSION_REF}/close`,
        `GET /sessions/${SESSION_REF}`,
      ]);
      expect(record.documentType).toBe('corrected');
      expect(record.regulatoryStatus).toBe('submitted');
      expect(record.providerInvoiceId).toBe(`${SESSION_REF}:${INVOICE_REF}`);
      // The KOR's own P_2 is the core-allocated correction-series documentNumber
      // (#1575), landed on the correction record (single source, #1338). It is
      // distinct from the original by construction (a separate series), so no
      // per-correction suffix hack is needed.
      expect(record.providerInvoiceNumber).toBe('FK/2026/06/0001');

      const built = lastInput();
      expect(built?.correction).toBeDefined();
      expect(built?.correction?.originalKsefNumber).toBe('1111111111-20260501-ABCDEF-01');
      expect(built?.correction?.originalInvoiceNumber).toBe('FV/2026/05/0042');
      // The delta (newQuantity: 1) was applied onto the original line (qty 2).
      expect(built?.correction?.correctedLines).toHaveLength(1);
      expect(built?.correction?.correctedLines?.[0]?.quantity).toBe(1);
    });

    it('should use the core-allocated correction-series documentNumber as the KOR P_2 (#1575)', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      const { record } = await adapter(http).issueCorrection(
        correctionCommand({ documentNumber: 'FK/2026/06/0099' }),
      );

      // The correction's P_2 is drawn from its own series upstream — never the
      // original document's number, and never a locally-derived suffix.
      expect(record.providerInvoiceNumber).toBe('FK/2026/06/0099');
      expect(record.providerInvoiceNumber).not.toBe('ol_order_123');
    });

    it('should apply newUnitPriceGross deltas while keeping name/taxRate from the original line', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);
      const { builder, lastInput } = capturingBuilder();

      await adapter(http, builder).issueCorrection(
        correctionCommand({ lines: [{ originalLineNumber: 1, newUnitPriceGross: 99.0 }] }),
      );

      const line = lastInput()?.correction?.correctedLines?.[0];
      expect(line?.quantity).toBe(2); // unchanged (only price corrected)
    });

    it('should throw KsefInvalidCorrectionException when no originalDocument snapshot was supplied', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      await expect(
        adapter(http).issueCorrection(correctionCommand({ originalDocument: undefined })),
      ).rejects.toBeInstanceOf(KsefInvalidCorrectionException);
      expect(http.calls).toHaveLength(0);
    });

    it('should throw KsefInvalidCorrectionException when originalLineNumber is out of range', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      await expect(
        adapter(http).issueCorrection(
          correctionCommand({ lines: [{ originalLineNumber: 5, newQuantity: 1 }] }),
        ),
      ).rejects.toBeInstanceOf(KsefInvalidCorrectionException);
      expect(http.calls).toHaveLength(0);
    });
  });

  describe('getSupportedDocumentTypes', () => {
    it('should return the two neutral types KSeF issues', () => {
      expect(adapter(new FakeKsefHttpClient()).getSupportedDocumentTypes()).toEqual([
        'invoice',
        'corrected',
      ]);
    });
  });

  describe('upsertCustomer', () => {
    it('should echo a stable provider customer id from the buyer tax id (no network)', async () => {
      const http = new FakeKsefHttpClient();
      const result = await adapter(http).upsertCustomer({ connectionId: 'conn-1', buyer: buyer() });
      expect(result.providerCustomerId).toBe('ksef:pl-nip:9876543210');
      expect(http.calls).toHaveLength(0);
    });
  });

  describe('isRegulatoryTransmitter', () => {
    it('should be true for the adapter', () => {
      expect(isRegulatoryTransmitter(adapter(new FakeKsefHttpClient()))).toBe(true);
    });
  });

  describe('getClearanceStatus (#1150 / C6)', () => {
    const KSEF_NUMBER = '5265877635-20250826-0100001AF629-AF';
    const PROVIDER_INVOICE_ID = `${SESSION_REF}:${INVOICE_REF}`;
    const STATUS_PATH = `/sessions/${SESSION_REF}/invoices/${INVOICE_REF}`;
    const UPO_PATH = `/sessions/${SESSION_REF}/invoices/${INVOICE_REF}/upo`;

    function record(): InvoiceRecord {
      return new InvoiceRecord(
        'rec-1',
        'conn-1',
        'ol_order_123',
        'ksef',
        'invoice',
        'issued',
        PROVIDER_INVOICE_ID, // composite {sessionRef}:{invoiceRef} packed by C5
        null,
        'submitted',
        null,
        null,
        null,
        new Date('2026-06-23T10:00:00.000Z'),
        null,
        new Date('2026-06-23T10:00:00.000Z'),
        new Date('2026-06-23T10:00:00.000Z'),
      );
    }

    it('should return submitted (no reference) while the invoice is in progress (150)', async () => {
      const http = new FakeKsefHttpClient();
      http.seed('GET', STATUS_PATH, { data: { status: { code: 150 } }, status: 200, headers: {} });

      const result = await adapter(http).getClearanceStatus(record());

      expect(result.regulatoryStatus).toBe('submitted');
      expect(result.clearanceReference).toBeNull();
    });

    it('should return rejected (terminal) on a known business-rejection code (440)', async () => {
      const http = new FakeKsefHttpClient();
      http.seed('GET', STATUS_PATH, { data: { status: { code: 440 } }, status: 200, headers: {} });

      const result = await adapter(http).getClearanceStatus(record());

      expect(result.regulatoryStatus).toBe('rejected');
      expect(result.clearanceReference).toBeNull();
    });

    it('should capture the KSeF number into clearanceReference on success (200)', async () => {
      const http = new FakeKsefHttpClient();
      http.seed('GET', STATUS_PATH, {
        data: {
          status: { code: 200 },
          ksefNumber: KSEF_NUMBER,
          upoDownloadUrl: 'https://ksef.example/upo/abc',
        },
        status: 200,
        headers: {},
      });

      const result = await adapter(http).getClearanceStatus(record());

      expect(result.regulatoryStatus).toBe('accepted');
      expect(result.clearanceReference).toBe(KSEF_NUMBER);
    });

    it('should fetch the session-scoped UPO pointer when not on the status payload', async () => {
      const http = new FakeKsefHttpClient();
      http
        .seed('GET', STATUS_PATH, {
          data: { status: { code: 200 }, ksefNumber: KSEF_NUMBER },
          status: 200,
          headers: {},
        })
        .seed('GET', UPO_PATH, {
          data: { upoDownloadUrl: 'https://ksef.example/upo/fallback' },
          status: 200,
          headers: {},
        });

      await adapter(http).getClearanceStatus(record());

      const paths = http.calls.map((c) => `${c.method} ${c.path}`);
      expect(paths).toContain(`GET ${UPO_PATH}`);
    });

    it('should not fail the clearance read when the UPO fetch errors (best-effort)', async () => {
      const http = new FakeKsefHttpClient();
      // status seeded (no upoDownloadUrl), UPO endpoint NOT seeded → fetch rejects, swallowed.
      http.seed('GET', STATUS_PATH, {
        data: { status: { code: 200 }, ksefNumber: KSEF_NUMBER },
        status: 200,
        headers: {},
      });

      const result = await adapter(http).getClearanceStatus(record());

      expect(result.regulatoryStatus).toBe('accepted');
      expect(result.clearanceReference).toBe(KSEF_NUMBER);
    });

    it('should throw when success (200) carries no valid KSeF number', async () => {
      const http = new FakeKsefHttpClient();
      http.seed('GET', STATUS_PATH, {
        data: { status: { code: 200 }, ksefNumber: 'not-a-ksef-number' },
        status: 200,
        headers: {},
      });

      await expect(adapter(http).getClearanceStatus(record())).rejects.toBeInstanceOf(
        KsefSessionException,
      );
    });

    it('should throw a retryable KsefNetworkException on a transient processing code (550)', async () => {
      const http = new FakeKsefHttpClient();
      http.seed('GET', STATUS_PATH, { data: { status: { code: 550 } }, status: 200, headers: {} });

      await expect(adapter(http).getClearanceStatus(record())).rejects.toBeInstanceOf(
        KsefNetworkException,
      );
    });

    it('should accept a bare composite-reference string and poll the session-scoped path', async () => {
      const http = new FakeKsefHttpClient();
      http.seed('GET', STATUS_PATH, { data: { status: { code: 150 } }, status: 200, headers: {} });

      const result = await adapter(http).getClearanceStatus(PROVIDER_INVOICE_ID);

      expect(result.regulatoryStatus).toBe('submitted');
      expect(http.calls.map((c) => c.path)).toContain(STATUS_PATH);
    });

    it('should throw when the providerInvoiceId carries no session reference (legacy bare value)', async () => {
      const http = new FakeKsefHttpClient();

      await expect(adapter(http).getClearanceStatus(INVOICE_REF)).rejects.toBeInstanceOf(
        KsefSessionException,
      );
    });
  });

  describe('submitForClearance (#1150 / C6)', () => {
    it('should echo the submitted status (no-op — clearance is folded into issue)', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);
      const { record: issued } = await adapter(http).issueInvoice(command());

      const result = await adapter(new FakeKsefHttpClient()).submitForClearance(issued);

      expect(result.regulatoryStatus).toBe('submitted');
      expect(result.clearanceReference).toBeNull();
    });
  });

  describe('getUpo (#1224 / C15)', () => {
    const PROVIDER_INVOICE_ID = `${SESSION_REF}:${INVOICE_REF}`;
    const UPO_PATH = `/sessions/${SESSION_REF}/invoices/${INVOICE_REF}/upo`;

    function record(providerInvoiceId: string | null = PROVIDER_INVOICE_ID): InvoiceRecord {
      return new InvoiceRecord(
        'rec-1',
        'conn-1',
        'ol_order_123',
        'ksef',
        'invoice',
        'issued',
        providerInvoiceId,
        null,
        'accepted',
        '5265877635-20250826-0100001AF629-AF',
        null,
        null,
        new Date('2026-06-23T10:00:00.000Z'),
        null,
        new Date('2026-06-23T10:00:00.000Z'),
        new Date('2026-06-23T10:00:00.000Z'),
      );
    }

    it('should be true for the RegulatoryDocumentReader guard', () => {
      expect(isRegulatoryDocumentReader(adapter(new FakeKsefHttpClient()))).toBe(true);
    });

    it('should fetch the session-scoped UPO endpoint as binary and return neutral bytes', async () => {
      const http = new FakeKsefHttpClient();
      const bytes = new Uint8Array([60, 85, 80, 79, 62]);
      http.seedBinaryGet(UPO_PATH, {
        data: bytes,
        contentType: 'application/xml',
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });

      const result = await adapter(http).getRegulatoryDocument(record());

      expect(result.content).toBe(bytes);
      expect(result.contentType).toBe('application/xml');
      expect(http.calls.map((c) => `${c.method} ${c.path}`)).toContain(`GET ${UPO_PATH}`);
    });

    it('should default the content type to application/xml when KSeF omits it', async () => {
      const http = new FakeKsefHttpClient();
      http.seedBinaryGet(UPO_PATH, {
        data: new Uint8Array([1]),
        contentType: '',
        status: 200,
        headers: {},
      });

      const result = await adapter(http).getRegulatoryDocument(record());

      expect(result.contentType).toBe('application/xml');
    });

    it('should throw when the record carries no composite invoice reference', async () => {
      await expect(adapter(new FakeKsefHttpClient()).getRegulatoryDocument(record(null))).rejects.toBeInstanceOf(
        KsefSessionException,
      );
    });

    it('should fetch UPO when kind is explicitly upo (back-compat default)', async () => {
      const http = new FakeKsefHttpClient();
      http.seedBinaryGet(UPO_PATH, {
        data: new Uint8Array([1]),
        contentType: 'application/xml',
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });

      const result = await adapter(http).getRegulatoryDocument(record(), 'confirmation');

      expect(result.contentType).toBe('application/xml');
      expect(http.calls.map((c) => `${c.method} ${c.path}`)).toContain(`GET ${UPO_PATH}`);
    });

    it('should reject a rendered-kind request with UnsupportedRegulatoryDocumentKindError', async () => {
      await expect(
        adapter(new FakeKsefHttpClient()).getRegulatoryDocument(record(), 'rendered'),
      ).rejects.toBeInstanceOf(UnsupportedRegulatoryDocumentKindError);
    });

    it('should reject a source-kind request via the adapter (core serves it from the snapshot)', async () => {
      await expect(
        adapter(new FakeKsefHttpClient()).getRegulatoryDocument(record(), 'source'),
      ).rejects.toBeInstanceOf(UnsupportedRegulatoryDocumentKindError);
    });
  });

  describe('offline issuance (#1701)', () => {
    it('should be exposed as OfflineResubmitter and RegulatoryRecordLocator', () => {
      const a = adapter(new FakeKsefHttpClient());
      expect(isOfflineResubmitter(a)).toBe(true);
      expect(isRegulatoryRecordLocator(a)).toBe(true);
    });

    it('should return a pending-submission record (no session landed) when KSeF is unavailable on open', async () => {
      const http = new OutageKsefHttpClient();
      http.failOn('POST', '/sessions/online', new KsefNetworkException('connection refused'));

      const { record, sourceDocument } = await adapter(http).issueInvoice(command());

      expect(record.status).toBe('issued');
      expect(record.regulatoryStatus).toBe('pending-submission');
      expect(record.providerInvoiceId).toBeNull();
      // The FA(3) is persisted as the neutral source document for later resubmit.
      expect(sourceDocument).toEqual({
        contentType: 'application/xml',
        contentBase64: Buffer.from('<Faktura>fake</Faktura>', 'utf-8').toString('base64'),
      });
      // Only the (failed) open was attempted — no submit, no close.
      expect(http.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /sessions/online']);
    });

    it('should go offline (and still close best-effort) when KSeF is unavailable on submit', async () => {
      const http = new OutageKsefHttpClient();
      seedHappyPath(http);
      http.failOn(
        'POST',
        `/sessions/online/${SESSION_REF}/invoices`,
        new KsefApiException('service unavailable', 503),
      );

      const { record } = await adapter(http).issueInvoice(command());

      expect(record.regulatoryStatus).toBe('pending-submission');
      expect(record.providerInvoiceId).toBeNull();
      const paths = http.calls.map((c) => `${c.method} ${c.path}`);
      // Session was opened, submit failed (503), close still attempted best-effort.
      expect(paths).toContain(`POST /sessions/online/${SESSION_REF}/invoices`);
      expect(paths).toContain(`POST /sessions/online/${SESSION_REF}/close`);
      // No session-status read on the offline path — nothing landed to assert.
      expect(paths).not.toContain(`GET /sessions/${SESSION_REF}`);
    });

    it('should still throw terminally on a content/validation rejection (429/5xx only go offline)', async () => {
      const http = new OutageKsefHttpClient();
      http.failOn(
        'POST',
        '/sessions/online',
        new KsefApiException('unprocessable entity', 422),
      );

      // A 422 is a deterministic content rejection — never offline.
      await expect(adapter(http).issueInvoice(command())).rejects.toBeInstanceOf(KsefApiException);
    });

    it('should throw terminally when the FA(3) build fails (offline only after a successful build)', async () => {
      const http = new OutageKsefHttpClient();
      seedHappyPath(http);
      const failingBuilder: IFa3XmlBuilder = {
        build(): RawFa3Xml {
          throw new KsefSessionException('build blew up');
        },
      };

      await expect(
        adapter(http, failingBuilder).issueInvoice(command()),
      ).rejects.toBeInstanceOf(KsefSessionException);
      // Build fails before any session work — the provider is never contacted.
      expect(http.calls).toHaveLength(0);
    });
  });

  describe('resubmit (#1701)', () => {
    it('should open a fresh session from the source XML and return a submitted result with a fresh providerInvoiceId', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      const result = await adapter(http).resubmit(offlineRecord());

      expect(result.regulatoryStatus).toBe('submitted');
      expect(result.providerInvoiceId).toBe(`${SESSION_REF}:${INVOICE_REF}`);
      expect(result.clearanceReference).toBeNull();
      // The full online-session sequence ran.
      expect(http.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        'POST /sessions/online',
        `POST /sessions/online/${SESSION_REF}/invoices`,
        `POST /sessions/online/${SESSION_REF}/close`,
        `GET /sessions/${SESSION_REF}`,
      ]);
    });

    it('should submit the persisted FA(3) source XML (not rebuild it)', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      await adapter(http).resubmit(offlineRecord());

      const submit = http.calls.find((c) => c.path.endsWith('/invoices'));
      // The encrypt is a passthrough double emitting a fixed ciphertext, so we
      // assert the submit fired with the plaintext-derived integrity hash present.
      const body = submit?.body as { invoiceHash: string };
      expect(body.invoiceHash).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should throw when KSeF is still unavailable (sweep backs off, record stays pending-submission)', async () => {
      const http = new OutageKsefHttpClient();
      http.failOn('POST', '/sessions/online', new KsefNetworkException('still down'));

      await expect(adapter(http).resubmit(offlineRecord())).rejects.toBeInstanceOf(
        KsefNetworkException,
      );
    });

    it('should throw terminally when the record carries no source-document XML', async () => {
      const http = new FakeKsefHttpClient();

      await expect(adapter(http).resubmit(offlineRecord(null))).rejects.toBeInstanceOf(
        KsefSessionException,
      );
      // Nothing to transmit — the provider is never contacted.
      expect(http.calls).toHaveLength(0);
    });
  });

  describe('locateByQuery (#1701)', () => {
    const KSEF_NUMBER = '5265877635-20250826-0100001AF629-AF';

    it('should map a found metadata item to an accepted result carrying the KSeF number', async () => {
      const http = new FakeKsefHttpClient();
      http.seed('POST', '/invoices/query/metadata', {
        data: {
          invoices: [{ ksefNumber: KSEF_NUMBER, invoiceNumber: 'FV/2026/06/0001', issueDate: '2026-06-23' }],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter(http).locateByQuery({
        sellerTaxId: '1234567890',
        documentNumber: 'FV/2026/06/0001',
        issuedFrom: new Date('2026-06-01T00:00:00.000Z'),
        issuedTo: new Date('2026-06-30T23:59:59.000Z'),
      });

      expect(result).toEqual({
        providerInvoiceId: null,
        regulatoryStatus: 'accepted',
        clearanceReference: KSEF_NUMBER,
      });
    });

    it('should return null when the authority holds no matching document', async () => {
      const http = new FakeKsefHttpClient();
      http.seed('POST', '/invoices/query/metadata', {
        data: { invoices: [] },
        status: 200,
        headers: {},
      });

      const result = await adapter(http).locateByQuery({ documentNumber: 'FV/2026/06/0001' });

      expect(result).toBeNull();
    });

    it('should not wrong-positive when the wire ignores the document-number filter', async () => {
      const http = new FakeKsefHttpClient();
      // A wire that returns a different document than requested must not match.
      http.seed('POST', '/invoices/query/metadata', {
        data: { invoices: [{ ksefNumber: KSEF_NUMBER, invoiceNumber: 'FV/2026/06/9999' }] },
        status: 200,
        headers: {},
      });

      const result = await adapter(http).locateByQuery({ documentNumber: 'FV/2026/06/0001' });

      expect(result).toBeNull();
    });

    it('should return null when no document number is supplied even if the authority returns a lone result (#1585 B1)', async () => {
      const http = new FakeKsefHttpClient();
      // A single unrelated invoice in the seller + date window must NOT be trusted
      // when the query carried no document number - it could be someone else's.
      http.seed('POST', '/invoices/query/metadata', {
        data: {
          invoices: [{ ksefNumber: KSEF_NUMBER, invoiceNumber: 'FV/2026/06/7777', issueDate: '2026-06-23' }],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter(http).locateByQuery({
        sellerTaxId: '1234567890',
        issuedFrom: new Date('2026-06-01T00:00:00.000Z'),
        issuedTo: new Date('2026-06-30T23:59:59.000Z'),
      });

      expect(result).toBeNull();
    });
  });
});
