/**
 * KSeF invoicing adapter specs — online-session issuance, neutral result purity,
 * 445 terminal-failure, document-type discovery, and the RegulatoryTransmitter
 * guard. The HTTP client + session crypto are mocked — no network, no real crypto.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import { isRegulatoryTransmitter } from '@openlinker/core/invoicing';
import type {
  BuyerProfile as BuyerProfileType,
  IssueInvoiceCommand,
} from '@openlinker/core/invoicing';
import { BuyerProfile } from '@openlinker/core/invoicing';
import { KsefInvoicingAdapter } from '../ksef-invoicing.adapter';
import { KsefSessionException } from '../../../domain/exceptions/ksef-session.exception';
import { KSEF_SESSION_CLOSED_ZERO_VALID } from '../ksef-session.types';
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

function seedHappyPath(http: FakeKsefHttpClient, sessionStatusCode = 200): void {
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
    .seed('GET', `/sessions/online/${SESSION_REF}`, {
      data: { status: { code: sessionStatusCode } },
      status: 200,
      headers: {},
    });
}

function adapter(http: FakeKsefHttpClient): KsefInvoicingAdapter {
  return new KsefInvoicingAdapter(
    'conn-1',
    http,
    fakeCrypto(),
    fakeBuilder,
    SELLER,
    () => new Date('2026-06-23T10:00:00.000Z'),
  );
}

describe('KsefInvoicingAdapter', () => {
  describe('issueInvoice', () => {
    it('should issue a VAT invoice end-to-end and return a submitted neutral record', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      const record = await adapter(http).issueInvoice(command());

      expect(record.providerInvoiceId).toBe(INVOICE_REF);
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
        `GET /sessions/online/${SESSION_REF}`,
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

    it('should throw KsefSessionException (not succeed) when session status is 445', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http, KSEF_SESSION_CLOSED_ZERO_VALID);

      await expect(adapter(http).issueInvoice(command())).rejects.toBeInstanceOf(KsefSessionException);
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

    it('should return a neutral result carrying no ksef/upo/fa strings', async () => {
      const http = new FakeKsefHttpClient();
      seedHappyPath(http);

      const record = await adapter(http).issueInvoice(command());
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
});
