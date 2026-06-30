/**
 * KSeF invoicing adapter specs — online-session issuance, neutral result purity,
 * zero-valid terminal-failure (count-based), document-type discovery, and the
 * RegulatoryTransmitter guard. The HTTP client + session crypto are mocked — no
 * network, no real crypto.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import {
  isRegulatoryDocumentReader,
  isRegulatoryTransmitter,
  UnsupportedRegulatoryDocumentKindError,
} from '@openlinker/core/invoicing';
import type {
  BuyerProfile as BuyerProfileType,
  IssueInvoiceCommand,
} from '@openlinker/core/invoicing';
import { BuyerProfile } from '@openlinker/core/invoicing';
import { KsefInvoicingAdapter } from '../ksef-invoicing.adapter';
import { KsefSessionException } from '../../../domain/exceptions/ksef-session.exception';
import { KsefNetworkException } from '../../../domain/exceptions/ksef-network.exception';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import { KsefUnsupportedDocumentTypeException } from '../../../domain/exceptions/ksef-unsupported-document-type.exception';
import { KsefInvalidCorrectionException } from '../../../domain/exceptions/ksef-invalid-correction.exception';
import { FakeKsefHttpClient } from '../../../testing/fake-ksef-http-client';
import type { KsefSessionCryptoService } from '../../crypto/ksef-session-crypto.service';
import type { SessionCryptoContext, EncryptedDocument } from '../../http/ksef-crypto.types';
import type { IFa3XmlBuilder } from '../../fa3/builders/fa3-xml-builder.port';
import type { Fa3BuilderInput, RawFa3Xml, SellerProfile } from '../../fa3/domain/fa3-xml.types';

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

function adapter(http: FakeKsefHttpClient, builder: IFa3XmlBuilder = fakeBuilder): KsefInvoicingAdapter {
  return new KsefInvoicingAdapter(
    'conn-1',
    http,
    fakeCrypto(),
    builder,
    SELLER,
    () => new Date('2026-06-23T10:00:00.000Z'),
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
});
