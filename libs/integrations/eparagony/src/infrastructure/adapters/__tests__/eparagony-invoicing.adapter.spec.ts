/**
 * eparagony.pl Invoicing Adapter - unit tests (#3192)
 *
 * Drives the whole issuance lifecycle against a fake transport: the create, the
 * bounded status poll, the three clearance answers, and the failure taxonomy -
 * which is the part that matters most, because a wrong `rejected` invites a
 * re-issue and a second invoice for one sale is a legal event for the seller.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters/__tests__
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import { BuyerProfile, InvoiceRecord } from '@openlinker/core/invoicing';
import type {
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  OriginalDocumentSnapshot,
  RegulatoryStatus,
} from '@openlinker/core/invoicing';

import { EPARAGONY_ISSUE_DEADLINE_MS } from '../../../eparagony.constants';
import { EparagonyApiError } from '../../../domain/exceptions/eparagony-api.error';
import { EparagonyConfigException } from '../../../domain/exceptions/eparagony-config.exception';
import { EparagonyNetworkError } from '../../../domain/exceptions/eparagony-network.error';
import {
  deriveDocumentToken,
  deriveTransactionToken,
} from '../../../domain/policies/document-token.policy';
import type { EparagonyDocumentStatusResponse } from '../../../domain/types/eparagony-api.types';
import type { EparagonyConnectionConfig } from '../../../domain/types/eparagony-config.types';
import type { IEparagonyHttpClient } from '../../http/eparagony-http-client.interface';
import type { EparagonyHttpResponse } from '../../http/eparagony-http-client.types';
import { EparagonyInvoicingAdapter } from '../eparagony-invoicing.adapter';

const CONNECTION_ID = 'conn-eparagony-1';
const IDEMPOTENCY_KEY = 'invoice:conn-eparagony-1:ol_order_1';
const EXPECTED_DOCUMENT_TOKEN = deriveDocumentToken(CONNECTION_ID, IDEMPOTENCY_KEY);
const CORRECTION_IDEMPOTENCY_KEY = `correction:${CONNECTION_ID}:ol_order_1`;
const EXPECTED_CORRECTION_DOCUMENT_TOKEN = deriveDocumentToken(
  CONNECTION_ID,
  CORRECTION_IDEMPOTENCY_KEY,
);

const logger: LoggerPort = {
  log: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeConfig(overrides: Partial<EparagonyConnectionConfig> = {}): EparagonyConnectionConfig {
  return {
    environment: 'sandbox',
    posId: 'openlinker',
    merchantTIN: '5252556107',
    eInvoicingHubEnabled: true,
    ...overrides,
  };
}

function makeCommand(overrides: Partial<IssueInvoiceCommand> = {}): IssueInvoiceCommand {
  return {
    connectionId: CONNECTION_ID,
    orderId: 'ol_order_1',
    buyer: new BuyerProfile(
      'Firma Polska sc.',
      { scheme: 'pl-nip', value: '6460558758' },
      {
        line1: 'Pl. Obroncow Lublina 73',
        line2: null,
        city: 'Warszawa',
        postalCode: '20-601',
        countryIso2: 'PL',
      },
      'company',
    ),
    currency: 'PLN',
    lines: [{ name: 'T-shirt', quantity: 2, unitPriceGross: 49.2, taxRate: '23' }],
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
}

const OFFLINE: EparagonyDocumentStatusResponse = {
  status: 'OFFLINE',
  documentType: 'INVOICE',
  processingMode: 'KSEF',
  invoiceNumber: 'OL-POC/2026/B2B/1',
  documentUrl: 'https://hub.sandbox.eparagony.pl/view/abc',
  ksefInvoice: {
    issueDate: '2026-09-15',
    invoiceHash: 'Gg3ukLWP07vsjm8Jv7vZBhdrCqACxATu8vCBXO/aKDk=',
    invoiceUrl: 'https://qr-demo.ksef.mf.gov.pl/client-app/invoice/5252556107/15-09-2026/x',
    issuerVerificationUrl: 'https://qr-test.ksef.mf.gov.pl/certificate/Nip/5252556107/y',
  },
};

const NO_HUB: EparagonyDocumentStatusResponse = {
  status: 'CONFIRMED',
  documentType: 'INVOICE',
  processingMode: 'NONE',
  invoiceNumber: 'OL-POC/2026/NOHUB/1',
  documentUrl: 'https://hub.sandbox.eparagony.pl/view/def',
};

const CLEARED: EparagonyDocumentStatusResponse = {
  status: 'CONFIRMED',
  documentType: 'INVOICE',
  processingMode: 'KSEF',
  invoiceNumber: 'OL-POC/2026/B2B/1',
  ksefInvoice: { ksefNumber: '5265877635-20250626-010080DD2B5E-26', invoiceHash: 'abc' },
};

const PENDING: EparagonyDocumentStatusResponse = {
  status: 'PENDING',
  documentType: 'INVOICE',
  processingMode: 'KSEF',
  invoiceNumber: 'OL-POC/2026/B2B/1',
};

const ERRORED: EparagonyDocumentStatusResponse = {
  status: 'ERROR',
  documentType: 'INVOICE',
  processingMode: 'KSEF',
  errorCode: 41,
  errorDescription: 'Incorrect merchantTIN for line "Red t-shirt"',
};

interface FakeClient extends IEparagonyHttpClient {
  post: jest.Mock;
  get: jest.Mock;
  invalidateToken: jest.Mock;
  ensureToken: jest.Mock;
}

function makeClient(
  statuses: Array<EparagonyDocumentStatusResponse | Error>,
  postBehaviour?: Error,
): FakeClient {
  const queue = [...statuses];
  return {
    post: jest
      .fn()
      .mockImplementation(() =>
        postBehaviour === undefined
          ? Promise.resolve({ status: 202, data: {} } as EparagonyHttpResponse<unknown>)
          : Promise.reject(postBehaviour),
      ),
    get: jest.fn().mockImplementation(() => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) {
        return Promise.reject(next);
      }
      return Promise.resolve({ status: 200, data: next } as EparagonyHttpResponse<unknown>);
    }),
    invalidateToken: jest.fn(),
    ensureToken: jest.fn().mockResolvedValue(undefined),
  };
}

function makeAdapter(
  client: IEparagonyHttpClient,
  config: EparagonyConnectionConfig = makeConfig(),
): EparagonyInvoicingAdapter {
  return new EparagonyInvoicingAdapter(CONNECTION_ID, client, logger, config);
}

function makeRecord(
  providerInvoiceId: string | null,
  regulatoryStatus: RegulatoryStatus = 'pending-submission',
  clearanceReference: string | null = null,
): InvoiceRecord {
  const now = new Date('2026-09-15T10:00:00Z');
  return new InvoiceRecord(
    'rec-1',
    CONNECTION_ID,
    'ol_order_1',
    'eparagony',
    'invoice',
    'issued',
    providerInvoiceId,
    'OL-POC/2026/B2B/1',
    regulatoryStatus,
    clearanceReference,
    IDEMPOTENCY_KEY,
    null,
    now,
    null,
    now,
    now,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('EparagonyInvoicingAdapter - issueInvoice', () => {
  it('issues the invoice and projects the neutral record once the document is issued', async () => {
    const client = makeClient([OFFLINE]);
    const { record } = await makeAdapter(client).issueInvoice(makeCommand());

    expect(record.status).toBe('issued');
    expect(record.providerType).toBe('eparagony');
    expect(record.documentType).toBe('invoice');
    // The vendor's only document key, and ours - deterministic, so a later
    // clearance read re-derives it from the same registration key.
    expect(record.providerInvoiceId).toBe(EXPECTED_DOCUMENT_TOKEN);
    expect(record.providerInvoiceNumber).toBe('OL-POC/2026/B2B/1');
    expect(record.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(record.regulatoryStatus).toBe('pending-submission');
    expect(record.clearanceReference).toBeNull();
    expect(record.errorMessage).toBeNull();
  });

  it("hands core the document's own per-line figures rather than letting it recompute them", async () => {
    // `IssueInvoiceResult.documentLines` is what stops
    // `InvoiceService.buildContent` falling back to a per-line
    // `round(gross / (1 + r))`. On a residual-absorbing order that fallback
    // states a net the issued document does not carry.
    const client = makeClient([OFFLINE]);
    const { documentLines } = await makeAdapter(client).issueInvoice(makeCommand());

    expect(documentLines).toBeDefined();
    // 1-based and in command order, which is how `buildContent` pairs them.
    expect(documentLines?.map((line) => line.lineNumber)).toEqual([1]);
  });

  it('refuses a correction, because this adapter issues originals only', async () => {
    // `getSupportedDocumentTypes()` declares `['invoice']`, but core does not
    // gate on it - `InvoiceService` passes `documentType` straight through and
    // only logs whether a correction was present. Without this guard the manual
    // `POST /invoices` path would issue a plain original and persist it under a
    // correction label. #3193 is where corrections arrive.
    const client = makeClient([OFFLINE]);
    await expect(
      makeAdapter(client).issueInvoice(
        makeCommand({
          correction: {
            originalClearanceReference: 'ref',
            originalDocumentNumber: 'FV/1',
            originalIssueDate: '2026-09-01',
            reason: 'price correction',
            correctedLines: [],
          },
        }),
      ),
    ).rejects.toThrow(EparagonyConfigException);
    // Refused BEFORE the boundary: nothing was sent.
    expect(client.post).not.toHaveBeenCalled();
  });

  it('refuses a document kind it does not issue rather than mislabelling an original', async () => {
    const client = makeClient([OFFLINE]);
    await expect(
      makeAdapter(client).issueInvoice(makeCommand({ documentType: 'credit-note' })),
    ).rejects.toThrow(EparagonyConfigException);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('sends the derived token pair and uses the token as the vendor idempotency key', async () => {
    const client = makeClient([OFFLINE]);
    await makeAdapter(client).issueInvoice(makeCommand());

    const [path, body, options] = client.post.mock.calls[0] as [
      string,
      { documentToken: string; transactionToken: string; eInvoice: { invoiceType: string } },
      { headers: Record<string, string>; idempotent: boolean },
    ];
    expect(path).toBe('documents');
    expect(body.documentToken).toBe(EXPECTED_DOCUMENT_TOKEN);
    // Required whenever `documentToken` is sent, and derived under its own
    // namespace so the two can never collide.
    expect(body.transactionToken).toBe(deriveTransactionToken(CONNECTION_ID, IDEMPOTENCY_KEY));
    expect(body.transactionToken).not.toBe(body.documentToken);
    expect(body.eInvoice.invoiceType).toBe('VAT');
    // The vendor's header rejects OL's colon-bearing raw key, so the derived
    // token stands in - which is what makes a transport re-issue safe.
    expect(options.headers['Idempotency-Key']).toBe(EXPECTED_DOCUMENT_TOKEN);
    expect(options.idempotent).toBe(true);
  });

  it('derives a per-order key when the command supplies none, so the token is still deterministic', async () => {
    const client = makeClient([OFFLINE]);
    const command = makeCommand();
    delete command.idempotencyKey;
    const { record } = await makeAdapter(client).issueInvoice(command);

    expect(record.providerInvoiceId).toBe(
      deriveDocumentToken(CONNECTION_ID, `invoice:${CONNECTION_ID}:ol_order_1`),
    );
    // Nothing to echo on the record - core supplied no key.
    expect(record.idempotencyKey).toBeNull();
  });

  it('carries the issued document link even at OFFLINE, unlike the receipt lane', async () => {
    // An invoice at OFFLINE is issued with legal effect and its visualisation
    // carries the authority's own offline verification codes.
    const client = makeClient([OFFLINE]);
    const { record } = await makeAdapter(client).issueInvoice(makeCommand());
    expect(record.pdfUrl).toBe('https://hub.sandbox.eparagony.pl/view/abc');
  });

  it('reports a document issued outside the hub as needing no clearance at all', async () => {
    const client = makeClient([NO_HUB]);
    const { record } = await makeAdapter(client).issueInvoice(makeCommand());

    expect(record.regulatoryStatus).toBe('not-applicable');
    expect(record.providerInvoiceNumber).toBe('OL-POC/2026/NOHUB/1');
  });

  it('returns as soon as the document exists and never waits for the hub', async () => {
    // Relay to the authority has no bounded duration; blocking issuance on it
    // would hold core's in-flight lease open for something `getClearanceStatus`
    // exists to reconcile.
    const client = makeClient([OFFLINE]);
    await makeAdapter(client).issueInvoice(makeCommand());
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('keeps polling past a transient PENDING', async () => {
    jest.useFakeTimers();
    try {
      const client = makeClient([PENDING, OFFLINE]);
      const promise = makeAdapter(client).issueInvoice(makeCommand());
      await jest.advanceTimersByTimeAsync(3_000);
      const { record } = await promise;
      expect(client.get).toHaveBeenCalledTimes(2);
      expect(record.regulatoryStatus).toBe('pending-submission');
    } finally {
      jest.useRealTimers();
    }
  });

  it('derives createDocument\'s own transport timeout from what is left of the whole-call deadline (#3192 review, I2)', async () => {
    const client = makeClient([OFFLINE]);
    await makeAdapter(client).issueInvoice(makeCommand());

    const [, , options] = client.post.mock.calls[0] as [string, unknown, { timeoutMs: number }];
    expect(options.timeoutMs).toBeGreaterThan(0);
    expect(options.timeoutMs).toBeLessThanOrEqual(EPARAGONY_ISSUE_DEADLINE_MS);
  });

  it('does not fire one more status read when the create already exhausted the whole-call deadline (#3192 review, I2)', async () => {
    jest.useFakeTimers();
    try {
      const client = makeClient([OFFLINE]);
      // Simulate a create that alone consumes the whole-call budget - the
      // poll must refuse before its first read rather than firing one more
      // full round trip on a budget that is already gone.
      client.post.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve({ status: 202, data: {} } as EparagonyHttpResponse<unknown>),
              EPARAGONY_ISSUE_DEADLINE_MS + 5_000,
            );
          }),
      );
      const promise = makeAdapter(client).issueInvoice(makeCommand());
      const assertion = expect(promise).rejects.toBeInstanceOf(EparagonyNetworkError);
      await jest.advanceTimersByTimeAsync(EPARAGONY_ISSUE_DEADLINE_MS + 5_000);
      await assertion;
      expect(client.get).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the single issuance instant core supplied rather than its own clock', async () => {
    const issuedAt = new Date('2026-09-15T08:00:00Z');
    const client = makeClient([OFFLINE]);
    const { record } = await makeAdapter(client).issueInvoice(makeCommand({ issuedAt }));
    expect(record.issuedAt?.toISOString()).toBe(issuedAt.toISOString());
  });

  it('reports the seller the connection configures, supplying the scheme tag itself', async () => {
    const client = makeClient([OFFLINE]);
    const result = await makeAdapter(
      client,
      makeConfig({
        merchantName: 'OpenLinker POC Sp. z o.o.',
        merchantAddress: {
          street: 'ul. Grzybowska',
          number: '2',
          postalCode: '00-131',
          city: 'Warszawa',
          country: 'PL',
        },
      }),
    ).issueInvoice(makeCommand());

    expect(result.seller).toMatchObject({
      name: 'OpenLinker POC Sp. z o.o.',
      taxId: { scheme: 'pl-nip', value: '5252556107' },
    });
  });

  it('omits the seller entirely when the connection configures none', async () => {
    const client = makeClient([OFFLINE]);
    const result = await makeAdapter(client).issueInvoice(makeCommand());
    expect('seller' in result).toBe(false);
  });
});

describe('EparagonyInvoicingAdapter - issueInvoice failures', () => {
  it('refuses a composition failure BEFORE anything crosses the boundary', async () => {
    const client = makeClient([OFFLINE]);
    await expect(
      makeAdapter(client, makeConfig({ merchantTIN: undefined })).issueInvoice(makeCommand()),
    ).rejects.toBeInstanceOf(EparagonyConfigException);
    // Nothing was sent, so nothing was issued - which is what makes the
    // `rejected` classification safe to re-attempt after a fix.
    expect(client.post).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
  });

  it('classifies a terminal vendor ERROR as rejected, not as in-doubt', async () => {
    const client = makeClient([ERRORED]);
    try {
      await makeAdapter(client).issueInvoice(makeCommand());
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(EparagonyApiError);
      expect((error as EparagonyApiError).failureMode).toBe('rejected');
    }
  });

  it("never promotes the vendor's error text into the operator-facing reason", async () => {
    // `errorDescription` quotes the printer and can echo a submitted line name.
    const client = makeClient([ERRORED]);
    try {
      await makeAdapter(client).issueInvoice(makeCommand());
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as EparagonyApiError).reason).not.toContain('Red t-shirt');
      expect((error as EparagonyApiError).reason).toContain('did not issue the invoice');
    }
  });

  it('leaves an unsettled poll IN DOUBT, because the vendor may still issue the document', async () => {
    jest.useFakeTimers();
    try {
      const client = makeClient([PENDING]);
      const promise = makeAdapter(client, makeConfig({ statusPollTimeoutMs: 5_000 })).issueInvoice(
        makeCommand(),
      );
      const assertion = expect(promise).rejects.toBeInstanceOf(EparagonyNetworkError);
      await jest.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads the status instead of re-creating when the vendor already holds our document', async () => {
    // Our token is deterministic, so "already exists" means OUR earlier attempt
    // landed. Reporting a rejection here would be the wrong-direction error.
    const alreadyExists = new EparagonyApiError('already exists', 409, { errorCode: 118 });
    const client = makeClient([OFFLINE], alreadyExists);
    const { record } = await makeAdapter(client).issueInvoice(makeCommand());

    expect(record.status).toBe('issued');
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('propagates any other create failure untouched, with its own classification', async () => {
    const rejected = new EparagonyApiError('bad request', 400, { errorCode: 41 });
    const client = makeClient([OFFLINE], rejected);
    await expect(makeAdapter(client).issueInvoice(makeCommand())).rejects.toBe(rejected);
    expect(client.get).not.toHaveBeenCalled();
  });
});

describe('EparagonyInvoicingAdapter - getClearanceStatus', () => {
  it("reads the relay progress off the record's own document token", async () => {
    const client = makeClient([CLEARED]);
    const result = await makeAdapter(client).getClearanceStatus(
      makeRecord(EXPECTED_DOCUMENT_TOKEN),
    );

    expect(client.get).toHaveBeenCalledWith(
      `documents/${encodeURIComponent(EXPECTED_DOCUMENT_TOKEN)}/status`,
    );
    expect(result).toEqual({
      regulatoryStatus: 'accepted',
      clearanceReference: '5265877635-20250626-010080DD2B5E-26',
    });
  });

  it('still reports awaiting submission while the document sits at OFFLINE', async () => {
    const client = makeClient([OFFLINE]);
    const result = await makeAdapter(client).getClearanceStatus(
      makeRecord(EXPECTED_DOCUMENT_TOKEN),
    );
    expect(result).toEqual({ regulatoryStatus: 'pending-submission', clearanceReference: null });
  });

  it.each([null, '', '   '])(
    'ECHOES the record rather than claiming not-applicable when the token is %p',
    async (token) => {
      // `not-applicable` is TERMINAL, so claiming it would stop the
      // reconciliation looking at a document whose relay may be perfectly
      // healthy, on the strength of a missing id.
      //
      // The record carries values that are NOT the defaults, deliberately: with
      // `pending-submission` / `null` on both sides a hardcoded return would
      // pass this test and prove nothing about echoing.
      const client = makeClient([CLEARED]);
      const result = await makeAdapter(client).getClearanceStatus(
        makeRecord(token, 'submitted', 'ref-echo'),
      );

      expect(result).toEqual({ regulatoryStatus: 'submitted', clearanceReference: 'ref-echo' });
      expect(client.get).not.toHaveBeenCalled();
    },
  );

  it('refuses a status body that is not an object at all, as in-doubt rather than as a verdict', async () => {
    // A contract break, not a status. `EparagonyNetworkError` is always
    // `in-doubt`, which is right: the document may exist perfectly well behind
    // an unreadable answer, so nothing here may look like a rejection.
    const client = makeClient([OFFLINE]);
    client.get.mockResolvedValue({ status: 200, data: 'not an object' });
    await expect(
      makeAdapter(client).getClearanceStatus(makeRecord(EXPECTED_DOCUMENT_TOKEN)),
    ).rejects.toBeInstanceOf(EparagonyNetworkError);

    client.get.mockResolvedValue({ status: 200, data: [OFFLINE] });
    await expect(
      makeAdapter(client).getClearanceStatus(makeRecord(EXPECTED_DOCUMENT_TOKEN)),
    ).rejects.toBeInstanceOf(EparagonyNetworkError);

    client.get.mockResolvedValue({ status: 200, data: null });
    await expect(
      makeAdapter(client).getClearanceStatus(makeRecord(EXPECTED_DOCUMENT_TOKEN)),
    ).rejects.toBeInstanceOf(EparagonyNetworkError);
  });

  it('echoes the record when the vendor holds no document under our token', async () => {
    const unknownDocument = new EparagonyApiError('unknown token', 404, { errorCode: 92 });
    const client = makeClient([unknownDocument]);
    const result = await makeAdapter(client).getClearanceStatus(
      makeRecord(EXPECTED_DOCUMENT_TOKEN, 'accepted', 'ref-1'),
    );
    expect(result).toEqual({ regulatoryStatus: 'accepted', clearanceReference: 'ref-1' });
  });

  it('propagates a transport failure so the reconciliation retries it', async () => {
    const transport = new EparagonyNetworkError('connection reset');
    const client = makeClient([transport]);
    await expect(
      makeAdapter(client).getClearanceStatus(makeRecord(EXPECTED_DOCUMENT_TOKEN)),
    ).rejects.toBe(transport);
  });
});

describe('EparagonyInvoicingAdapter - the rest of the port', () => {
  it('answers null for getInvoice, which core serves from its own projection', async () => {
    const client = makeClient([OFFLINE]);
    await expect(makeAdapter(client).getInvoice({ orderId: 'ol_order_1' })).resolves.toBeNull();
    expect(client.get).not.toHaveBeenCalled();
  });

  it('declares only the invoice document type, because corrections are a separate document', () => {
    expect(makeAdapter(makeClient([OFFLINE])).getSupportedDocumentTypes()).toEqual(['invoice']);
  });

  it('returns a fresh array so a caller cannot mutate the declared set', () => {
    const adapter = makeAdapter(makeClient([OFFLINE]));
    adapter.getSupportedDocumentTypes().push('receipt');
    expect(adapter.getSupportedDocumentTypes()).toEqual(['invoice']);
  });
});

describe('EparagonyInvoicingAdapter - upsertCustomer', () => {
  function buyer(taxId: { scheme?: string; value: string } | null): BuyerProfile {
    return new BuyerProfile(
      'Firma Polska sc.',
      taxId,
      {
        line1: 'Pl. Obroncow Lublina 73',
        line2: null,
        city: 'Warszawa',
        postalCode: '20-601',
        countryIso2: 'PL',
      },
      taxId === null ? 'private' : 'company',
    );
  }

  it('echoes a stable handle derived from the buyer tax id, with no network call', async () => {
    const client = makeClient([OFFLINE]);
    const result = await makeAdapter(client).upsertCustomer({
      connectionId: CONNECTION_ID,
      buyer: buyer({ scheme: 'pl-nip', value: '6460558758' }),
    });

    expect(result.providerCustomerId).toBe('eparagony:pl-nip:6460558758');
    expect(client.post).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
  });

  it('gives ONE buyer ONE handle whether the tax id arrived tagged or untagged', async () => {
    // `scheme` is optional since ADR-073, so interpolating it raw would render
    // `eparagony:undefined:...` and split one buyer across two handles
    // depending on which path issued.
    const adapter = makeAdapter(makeClient([OFFLINE]));
    const tagged = await adapter.upsertCustomer({
      connectionId: CONNECTION_ID,
      buyer: buyer({ scheme: 'pl-nip', value: '6460558758' }),
    });
    const untagged = await adapter.upsertCustomer({
      connectionId: CONNECTION_ID,
      buyer: buyer({ value: '6460558758' }),
    });

    expect(untagged.providerCustomerId).toBe(tagged.providerCustomerId);
    expect(untagged.providerCustomerId).not.toContain('undefined');
  });

  it('falls back to a connection-scoped guest handle for a buyer with no tax id', async () => {
    const result = await makeAdapter(makeClient([OFFLINE])).upsertCustomer({
      connectionId: CONNECTION_ID,
      buyer: buyer(null),
    });
    expect(result.providerCustomerId).toBe(`eparagony:${CONNECTION_ID}:guest`);
  });
});

// -----------------------------------------------------------------------------
// issueCorrection (#3193)
// -----------------------------------------------------------------------------

/**
 * A correction requires `merchantName` and a complete `merchantAddress`, neither
 * of which a receipts-shaped config carries - the vendor's `correctingMetadata`
 * has no fallback to the account's own registered identity the way a plain
 * invoice's `metadata` does.
 */
function makeCorrectionConfig(
  overrides: Partial<EparagonyConnectionConfig> = {},
): EparagonyConnectionConfig {
  return makeConfig({
    merchantName: 'OpenLinker POC Sp. z o.o.',
    merchantAddress: {
      street: 'ul. Grzybowska',
      number: '2',
      postalCode: '00-131',
      city: 'Warszawa',
      country: 'PL',
    },
    ...overrides,
  });
}

function makeOriginalDocument(
  overrides: Partial<OriginalDocumentSnapshot> = {},
): OriginalDocumentSnapshot {
  return {
    buyer: new BuyerProfile(
      'Firma Polska sc.',
      { scheme: 'pl-nip', value: '6460558758' },
      {
        line1: 'Pl. Obroncow Lublina 73',
        line2: null,
        city: 'Warszawa',
        postalCode: '20-601',
        countryIso2: 'PL',
      },
      'company',
    ),
    currency: 'PLN',
    documentType: 'invoice',
    lines: [{ name: 'T-shirt', quantity: 2, unitPriceGross: 49.2, taxRate: '23' }],
    clearanceReference: '5265877635-20250626-010080DD2B5E-26',
    documentNumber: 'OL-POC/2026/B2B/1',
    issueDate: '2026-09-15',
    ...overrides,
  };
}

function makeCorrectionCommand(
  overrides: Partial<IssueCorrectionCommand> = {},
): IssueCorrectionCommand {
  return {
    connectionId: CONNECTION_ID,
    orderId: 'ol_order_1',
    originalProviderInvoiceId: EXPECTED_DOCUMENT_TOKEN,
    reason: 'buyer returned one unit',
    lines: [{ originalLineNumber: 1, newQuantity: 1 }],
    idempotencyKey: CORRECTION_IDEMPOTENCY_KEY,
    originalDocument: makeOriginalDocument(),
    ...overrides,
  };
}

describe('EparagonyInvoicingAdapter - issueCorrection', () => {
  it('issues the correction and projects the neutral record once the document is issued', async () => {
    const client = makeClient([OFFLINE]);
    const { record } = await makeAdapter(client, makeCorrectionConfig()).issueCorrection(
      makeCorrectionCommand(),
    );

    expect(record.status).toBe('issued');
    expect(record.providerType).toBe('eparagony');
    // Defaults to 'corrected' when the caller names no explicit document type.
    expect(record.documentType).toBe('corrected');
    expect(record.providerInvoiceId).toBe(EXPECTED_CORRECTION_DOCUMENT_TOKEN);
    expect(record.idempotencyKey).toBe(CORRECTION_IDEMPOTENCY_KEY);
    expect(record.regulatoryStatus).toBe('pending-submission');
  });

  it("honours a caller-supplied document type rather than forcing 'corrected'", async () => {
    const client = makeClient([OFFLINE]);
    const { record } = await makeAdapter(client, makeCorrectionConfig()).issueCorrection(
      makeCorrectionCommand({ documentType: 'credit-note' }),
    );
    expect(record.documentType).toBe('credit-note');
  });

  it('derives a DIFFERENT token pair than an original invoice on the SAME order with no key', async () => {
    // Without the namespace, an idempotency-key-less correction would derive the
    // invoice's own documentToken and the vendor - which dedupes on that token -
    // would answer the correction with the original document.
    const client = makeClient([OFFLINE]);
    const command = makeCorrectionCommand();
    delete command.idempotencyKey;
    const { record } = await makeAdapter(client, makeCorrectionConfig()).issueCorrection(command);

    expect(record.providerInvoiceId).not.toBe(EXPECTED_DOCUMENT_TOKEN);
    expect(record.providerInvoiceId).toBe(EXPECTED_CORRECTION_DOCUMENT_TOKEN);
  });

  it('sends the eCorrectiveInvoice body under its own derived token pair', async () => {
    const client = makeClient([OFFLINE]);
    await makeAdapter(client, makeCorrectionConfig()).issueCorrection(makeCorrectionCommand());

    const [path, body, options] = client.post.mock.calls[0] as [
      string,
      {
        documentToken: string;
        transactionToken: string;
        eCorrectiveInvoice: {
          invoiceType: string;
          correctedMetadata: { invoiceNumber: string };
        };
      },
      { headers: Record<string, string>; idempotent: boolean },
    ];

    expect(path).toBe('documents');
    expect(body.documentToken).toBe(EXPECTED_CORRECTION_DOCUMENT_TOKEN);
    expect(body.transactionToken).toBe(
      deriveTransactionToken(CONNECTION_ID, CORRECTION_IDEMPOTENCY_KEY),
    );
    expect(body.eCorrectiveInvoice.invoiceType).toBe('VAT');
    expect(body.eCorrectiveInvoice.correctedMetadata.invoiceNumber).toBe('OL-POC/2026/B2B/1');
    // The same idempotency header the issue path sends, for the same reason.
    expect(options.headers['Idempotency-Key']).toBe(EXPECTED_CORRECTION_DOCUMENT_TOKEN);
    expect(options.idempotent).toBe(true);
  });

  it("hands core the corrected document's own per-line figures", async () => {
    const client = makeClient([OFFLINE]);
    const { documentLines } = await makeAdapter(client, makeCorrectionConfig()).issueCorrection(
      makeCorrectionCommand(),
    );
    expect(documentLines).toEqual([
      { lineNumber: 1, unitNet: 40, net: 40, tax: 9.2, gross: 49.2 },
    ]);
  });

  it('reports the seller the connection configures, exactly as an original invoice does', async () => {
    const client = makeClient([OFFLINE]);
    const result = await makeAdapter(client, makeCorrectionConfig()).issueCorrection(
      makeCorrectionCommand(),
    );
    expect(result.seller).toMatchObject({
      name: 'OpenLinker POC Sp. z o.o.',
      taxId: { scheme: 'pl-nip', value: '5252556107' },
    });
  });

  it('polls past a non-terminal status before reporting the correction issued', async () => {
    const client = makeClient([PENDING, OFFLINE]);
    const { record } = await makeAdapter(client, makeCorrectionConfig()).issueCorrection(
      makeCorrectionCommand(),
    );
    expect(record.status).toBe('issued');
    expect(client.get.mock.calls.length).toBeGreaterThan(1);
  });

  it('classifies a terminal vendor ERROR as rejected, same as the invoice path', async () => {
    const client = makeClient([ERRORED]);
    await expect(
      makeAdapter(client, makeCorrectionConfig()).issueCorrection(makeCorrectionCommand()),
    ).rejects.toBeInstanceOf(EparagonyApiError);

    const error = await makeAdapter(client, makeCorrectionConfig())
      .issueCorrection(makeCorrectionCommand())
      .catch((caught: unknown) => caught);
    expect((error as EparagonyApiError).failureMode).toBe('rejected');
  });

  it('refuses a composition failure BEFORE anything crosses the boundary', async () => {
    const client = makeClient([OFFLINE]);
    await expect(
      makeAdapter(client, makeCorrectionConfig({ merchantName: undefined })).issueCorrection(
        makeCorrectionCommand(),
      ),
    ).rejects.toBeInstanceOf(EparagonyConfigException);

    expect(client.post).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
  });

  it('issues a NEW document and never re-reads the original it corrects', async () => {
    // The correction composes solely from the caller-supplied snapshot and
    // issues an independent document under its own token - it never resolves
    // the original, and never writes back to the snapshot it was handed.
    const client = makeClient([OFFLINE]);
    const originalDocument = makeOriginalDocument();
    await makeAdapter(client, makeCorrectionConfig()).issueCorrection(
      makeCorrectionCommand({ originalDocument }),
    );

    for (const [path] of client.get.mock.calls as Array<[string]>) {
      expect(path).toContain(EXPECTED_CORRECTION_DOCUMENT_TOKEN);
      expect(path).not.toContain(EXPECTED_DOCUMENT_TOKEN);
    }
    expect(originalDocument.documentNumber).toBe('OL-POC/2026/B2B/1');
    expect(originalDocument.lines).toHaveLength(1);
  });
});
