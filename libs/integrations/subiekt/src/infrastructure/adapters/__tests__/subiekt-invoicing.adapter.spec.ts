/**
 * Subiekt Invoicing Adapter — unit tests (#753)
 *
 * Driven against FakeSubiektBridgeAdapter (never real HTTP). Covers issuance
 * success, error translation, getInvoice no-ops, doctype discovery, and the
 * idempotency / retryability obligations.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import {
  BuyerProfile,
  InvoiceRecord,
  isCorrectionIssuer,
  isRegulatoryStatusReader,
} from '@openlinker/core/invoicing';
import type {
  BuyerAddress,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  TaxIdentifier,
} from '@openlinker/core/invoicing';
import type { LoggerPort } from '@openlinker/shared/logging';
import { FakeSubiektBridgeAdapter } from '../../../testing/fake-subiekt-bridge.adapter';
import {
  SubiektInvoicingAdapter,
  SUBIEKT_PROVIDER_TYPE,
} from '../subiekt-invoicing.adapter';
import { SubiektInvoiceRejectedError } from '../../../domain/exceptions/subiekt-invoice-rejected.exception';
import { SubiektBridgeTransportError } from '../../../domain/exceptions/subiekt-bridge-transport.exception';
import { SubiektUnsupportedDocumentTypeError } from '../../../domain/exceptions/subiekt-unsupported-document-type.exception';

const ADDRESS: BuyerAddress = {
  line1: 'ul. Przykładowa 1',
  line2: null,
  city: 'Warszawa',
  postalCode: '00-001',
  countryIso2: 'PL',
};

function buyer(taxId: TaxIdentifier | null, type: 'company' | 'private' = 'company'): BuyerProfile {
  return new BuyerProfile('Acme Sp. z o.o.', taxId, ADDRESS, type);
}

function command(overrides: Partial<IssueInvoiceCommand> = {}): IssueInvoiceCommand {
  return {
    connectionId: 'conn-1',
    orderId: 'ol_order_1',
    buyer: buyer({ scheme: 'pl-nip', value: '1234567890' }),
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123.0, taxRate: '23' }],
    ...overrides,
  };
}

function correctionCommand(
  overrides: Partial<IssueCorrectionCommand> = {},
): IssueCorrectionCommand {
  return {
    connectionId: 'conn-1',
    orderId: 'ol_order_1',
    originalProviderInvoiceId: '100001',
    reason: 'Zwrot towaru',
    lines: [{ originalLineNumber: 1, newQuantity: 2, newUnitPriceGross: 99.0 }],
    ...overrides,
  };
}

function makeLogger(): LoggerPort {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeAdapter(bridge = new FakeSubiektBridgeAdapter()): {
  adapter: SubiektInvoicingAdapter;
  bridge: FakeSubiektBridgeAdapter;
  logger: LoggerPort;
} {
  const logger = makeLogger();
  const adapter = new SubiektInvoicingAdapter(bridge, 'conn-1', logger);
  return { adapter, bridge, logger };
}

describe('SubiektInvoicingAdapter', () => {
  describe('issueInvoice', () => {
    it('builds a correct transient issued InvoiceRecord on success', async () => {
      const { adapter } = makeAdapter();
      const record = await adapter.issueInvoice(command());
      expect(record.status).toBe('issued');
      expect(record.connectionId).toBe('conn-1');
      expect(record.orderId).toBe('ol_order_1');
      // The fake mints a numeric Subiekt id (100_000 + n); the adapter stringifies.
      expect(record.providerInvoiceId).toBe('100001');
      expect(record.providerInvoiceNumber).toBe('FV-MOCK-001');
      expect(record.id).toBeTruthy();
      expect(record.createdAt).toBeInstanceOf(Date);
      expect(record.updatedAt).toBeInstanceOf(Date);
    });

    it('stamps providerType=subiekt and the neutral documentType', async () => {
      const { adapter } = makeAdapter();
      const record = await adapter.issueInvoice(command());
      expect(record.providerType).toBe(SUBIEKT_PROVIDER_TYPE);
      expect(SUBIEKT_PROVIDER_TYPE).toBe('subiekt');
      // NEUTRAL, never the bridge-native 'faktura'.
      expect(record.documentType).toBe('invoice');
    });

    it('uses the receipt neutral type for a buyer with no nip', async () => {
      const { adapter } = makeAdapter();
      const record = await adapter.issueInvoice(command({ buyer: buyer(null) }));
      expect(record.documentType).toBe('receipt');
    });

    it('maps the bridge regulatoryStatus onto the neutral value', async () => {
      const { adapter } = makeAdapter();
      // The fake returns regulatoryStatus 'sent' -> neutral 'submitted'.
      const record = await adapter.issueInvoice(command());
      expect(record.regulatoryStatus).toBe('submitted');
    });

    it('echoes idempotencyKey onto the returned InvoiceRecord', async () => {
      const { adapter } = makeAdapter();
      const record = await adapter.issueInvoice(command({ idempotencyKey: 'idem-xyz' }));
      expect(record.idempotencyKey).toBe('idem-xyz');
    });

    it('passes command.idempotencyKey to the bridge on success (spy)', async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'issueInvoice');
      await adapter.issueInvoice(command({ idempotencyKey: 'idem-xyz' }));
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'idem-xyz' }));
    });

    it('still carries the original idempotencyKey to the bridge under seedFailure(bridge-unreachable) (spy)', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('bridge-unreachable');
      const spy = jest.spyOn(bridge, 'issueInvoice');
      await expect(adapter.issueInvoice(command({ idempotencyKey: 'idem-xyz' }))).rejects.toThrow(
        SubiektBridgeTransportError,
      );
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'idem-xyz' }));
    });

    it('translates seedFailure(subiekt-rejected) -> SubiektInvoiceRejectedError (terminal)', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('subiekt-rejected', { reason: 'invalid NIP' });
      const caught = await adapter.issueInvoice(command()).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(SubiektInvoiceRejectedError);
      // #1200 neutral discriminator: a terminal rejection => no document => safe.
      expect(caught).toMatchObject({ failureMode: 'rejected' });
    });

    it("translates seed({state:'failed'}) -> SubiektInvoiceRejectedError (terminal)", async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seed({ state: 'failed' });
      await expect(adapter.issueInvoice(command())).rejects.toBeInstanceOf(
        SubiektInvoiceRejectedError,
      );
    });

    it('translates seedFailure(bridge-unreachable) -> SubiektBridgeTransportError', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.issueInvoice(command())).rejects.toBeInstanceOf(
        SubiektBridgeTransportError,
      );
    });

    it("defaults retryability to 'indeterminate' for the phase-less fake unreachable error", async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.issueInvoice(command())).rejects.toMatchObject({
        retryability: 'indeterminate',
        retryable: false,
        // #1200: an indeterminate transport failure => document may exist => in-doubt.
        failureMode: 'in-doubt',
      });
    });

    it("wraps a genuinely-unknown throwable into a Subiekt-typed 'indeterminate' transport error", async () => {
      // Keeps the fiscal-safe "unknown -> non-retryable" intent LOCAL to the
      // Subiekt path so the retry classifier needs no global catch-all that
      // would wrongly mark sibling plugins' errors non-retryable.
      const { adapter, bridge } = makeAdapter();
      const original = new Error('socket hang up');
      jest.spyOn(bridge, 'issueInvoice').mockRejectedValue(original);
      const caught = await adapter.issueInvoice(command()).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(SubiektBridgeTransportError);
      expect(caught).toMatchObject({ retryability: 'indeterminate', retryable: false });
      // Original throwable preserved for debugging.
      expect((caught as SubiektBridgeTransportError).cause).toBe(original);
    });

    it('rejects an explicit unsupported, non-correction documentType with SubiektUnsupportedDocumentTypeError', async () => {
      const { adapter } = makeAdapter();
      await expect(
        adapter.issueInvoice(command({ documentType: 'proforma' })),
      ).rejects.toBeInstanceOf(SubiektUnsupportedDocumentTypeError);
    });

    it("honours an explicit supported documentType through issueInvoice (overrides the NIP-derived default)", async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'issueInvoice');
      // Buyer HAS a NIP -> the derived default would be 'invoice'; an explicit
      // 'receipt' must win and map to the bridge-native 'paragon'.
      const record = await adapter.issueInvoice(
        command({ buyer: buyer({ scheme: 'pl-nip', value: '1234567890' }), documentType: 'receipt' }),
      );
      expect(record.documentType).toBe('receipt');
      // Bridge-native document type: receipt -> 'PA' (paragon).
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'PA' }));
    });

    it("honours an explicit documentType 'invoice' through issueInvoice (maps to FV)", async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'issueInvoice');
      const record = await adapter.issueInvoice(command({ documentType: 'invoice' }));
      expect(record.documentType).toBe('invoice');
      // Bridge-native document type: invoice -> 'FV' (faktura).
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'FV' }));
    });
  });

  describe('upsertCustomer', () => {
    it('returns { providerCustomerId } from the bridge', async () => {
      const { adapter } = makeAdapter();
      const result = await adapter.upsertCustomer({ connectionId: 'conn-1', buyer: buyer(null) });
      // The fake mints a numeric customer id (200_000 + n); the adapter stringifies.
      expect(result.providerCustomerId).toBe('200001');
    });

    it('translates bridge errors the same way as issueInvoice', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('subiekt-rejected', { reason: 'bad customer' });
      await expect(
        adapter.upsertCustomer({ connectionId: 'conn-1', buyer: buyer(null) }),
      ).rejects.toBeInstanceOf(SubiektInvoiceRejectedError);
    });
  });

  describe('getInvoice', () => {
    it('returns null for the { orderId } branch', async () => {
      const { adapter } = makeAdapter();
      expect(await adapter.getInvoice({ orderId: 'ol_order_1' })).toBeNull();
    });

    it('returns null for the { providerInvoiceId } branch', async () => {
      const { adapter } = makeAdapter();
      expect(await adapter.getInvoice({ providerInvoiceId: 'SUB-MOCK-1' })).toBeNull();
    });

    it('does NOT call bridge.getInvoiceStatus from getInvoice', async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'getInvoiceStatus');
      await adapter.getInvoice({ providerInvoiceId: 'SUB-MOCK-1' });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('getSupportedDocumentTypes', () => {
    it("returns ['invoice','receipt','credit-note','corrected']", () => {
      const { adapter } = makeAdapter();
      expect(adapter.getSupportedDocumentTypes()).toEqual([
        'invoice',
        'receipt',
        'credit-note',
        'corrected',
      ]);
    });
  });

  describe('correction documents (#1229)', () => {
    it('is detected as a CorrectionIssuer', () => {
      const adapter = makeAdapter().adapter;
      expect(isCorrectionIssuer(adapter)).toBe(true);
    });

    it('rejects a correction doctype on the plain issueInvoice path (corrections use issueCorrection)', async () => {
      const { adapter } = makeAdapter();
      await expect(
        adapter.issueInvoice(command({ documentType: 'credit-note' })),
      ).rejects.toBeInstanceOf(SubiektUnsupportedDocumentTypeError);
    });

    it('issues a quantity-only correction via the bridge correction endpoint', async () => {
      const { adapter, bridge } = makeAdapter();
      const correctionSpy = jest.spyOn(bridge, 'issueCorrection');
      const record = await adapter.issueCorrection(
        correctionCommand({ lines: [{ originalLineNumber: 1, newQuantity: 5 }] }),
      );
      // origId path arg parsed from originalProviderInvoiceId; body carries only nowaIlosc.
      expect(correctionSpy).toHaveBeenCalledWith(100001, {
        przyczyna: 'Zwrot towaru',
        lines: [{ lp: 1, nowaIlosc: 5 }],
      });
      expect(record.status).toBe('issued');
      // Distinct correction id space (300_000+).
      expect(record.providerInvoiceId).toBe('300001');
      expect(record.providerInvoiceNumber).toBe('FK-MOCK-001');
    });

    it('issues a price-only correction (nowaCena from newUnitPriceGross, no nowaIlosc)', async () => {
      const { adapter, bridge } = makeAdapter();
      const correctionSpy = jest.spyOn(bridge, 'issueCorrection');
      await adapter.issueCorrection(
        correctionCommand({ lines: [{ originalLineNumber: 2, newUnitPriceGross: 80.5 }] }),
      );
      expect(correctionSpy).toHaveBeenCalledWith(100001, {
        przyczyna: 'Zwrot towaru',
        lines: [{ lp: 2, nowaCena: 80.5 }],
      });
    });

    it('issues a correction with BOTH quantity and price changes on a line', async () => {
      const { adapter, bridge } = makeAdapter();
      const correctionSpy = jest.spyOn(bridge, 'issueCorrection');
      await adapter.issueCorrection(
        correctionCommand({
          lines: [{ originalLineNumber: 1, newQuantity: 3, newUnitPriceGross: 12.0 }],
        }),
      );
      expect(correctionSpy).toHaveBeenCalledWith(100001, {
        przyczyna: 'Zwrot towaru',
        lines: [{ lp: 1, nowaIlosc: 3, nowaCena: 12.0 }],
      });
    });

    it('rejects a non-positive-integer originalProviderInvoiceId without a bridge call', async () => {
      const { adapter, bridge } = makeAdapter();
      const correctionSpy = jest.spyOn(bridge, 'issueCorrection');
      await expect(
        adapter.issueCorrection(correctionCommand({ originalProviderInvoiceId: 'not-a-number' })),
      ).rejects.toBeInstanceOf(SubiektInvoiceRejectedError);
      expect(correctionSpy).not.toHaveBeenCalled();
    });

    it('echoes the command idempotencyKey onto the returned record', async () => {
      const { adapter } = makeAdapter();
      const record = await adapter.issueCorrection(correctionCommand({ idempotencyKey: 'idem-kor' }));
      expect(record.idempotencyKey).toBe('idem-kor');
    });

    it('sends command.idempotencyKey on the korekta request body (#1229)', async () => {
      const { adapter, bridge } = makeAdapter();
      const correctionSpy = jest.spyOn(bridge, 'issueCorrection');
      await adapter.issueCorrection(correctionCommand({ idempotencyKey: 'idem-kor' }));
      expect(correctionSpy).toHaveBeenCalledWith(
        100001,
        expect.objectContaining({ idempotencyKey: 'idem-kor' }),
      );
      // The fake also captures the raw body — assert passthrough end-to-end.
      expect(bridge.getLastKorektaRequest()?.idempotencyKey).toBe('idem-kor');
    });

    it('omits idempotencyKey from the korekta body when the command has none', async () => {
      const { adapter, bridge } = makeAdapter();
      await adapter.issueCorrection(correctionCommand());
      expect(bridge.getLastKorektaRequest()).not.toHaveProperty('idempotencyKey');
    });

    it('rejects an unsupported correction documentType with SubiektUnsupportedDocumentTypeError', async () => {
      const { adapter, bridge } = makeAdapter();
      const correctionSpy = jest.spyOn(bridge, 'issueCorrection');
      await expect(
        adapter.issueCorrection(correctionCommand({ documentType: 'invoice' })),
      ).rejects.toBeInstanceOf(SubiektUnsupportedDocumentTypeError);
      // Clamp happens before any bridge call.
      expect(correctionSpy).not.toHaveBeenCalled();
    });

    it("defaults documentType to 'corrected' when the command omits it, honours an explicit one", async () => {
      const { adapter } = makeAdapter();
      const def = await adapter.issueCorrection(correctionCommand());
      expect(def.documentType).toBe('corrected');
      const explicit = await adapter.issueCorrection(
        correctionCommand({ documentType: 'credit-note' }),
      );
      expect(explicit.documentType).toBe('credit-note');
    });

    it("defaults regulatoryStatus to 'submitted' (the korekta response carries none)", async () => {
      const { adapter } = makeAdapter();
      const record = await adapter.issueCorrection(correctionCommand());
      expect(record.regulatoryStatus).toBe('submitted');
      expect(record.pdfUrl).toBeNull();
    });

    it("translates a failed correction (state:'failed') -> SubiektInvoiceRejectedError", async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seed({ state: 'failed' });
      await expect(adapter.issueCorrection(correctionCommand())).rejects.toBeInstanceOf(
        SubiektInvoiceRejectedError,
      );
    });

    it('translates a correction transport failure -> SubiektBridgeTransportError', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.issueCorrection(correctionCommand())).rejects.toBeInstanceOf(
        SubiektBridgeTransportError,
      );
    });
  });

  describe('getClearanceStatus (#1230)', () => {
    it('is detected as a RegulatoryStatusReader', () => {
      const adapter = makeAdapter().adapter;
      expect(isRegulatoryStatusReader(adapter)).toBe(true);
    });

    it('reads the bridge status for an issued record and maps it to a neutral result', async () => {
      const adapter = makeAdapter().adapter;
      // Issue first so the fake remembers the document id (regulatoryStatus 'sent').
      const issued = await adapter.issueInvoice(command());
      const result = await adapter.getClearanceStatus(issued);
      // 'sent' -> neutral 'submitted'.
      expect(result.regulatoryStatus).toBe('submitted');
    });

    it('maps a terminal accepted bridge status onto the neutral accepted', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seed({ regulatoryStatus: 'accepted' });
      const issued = await adapter.issueInvoice(command());
      const result = await adapter.getClearanceStatus(issued);
      expect(result.regulatoryStatus).toBe('accepted');
    });

    it('maps a terminal rejected bridge status onto the neutral rejected (data, not throw)', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seed({ regulatoryStatus: 'rejected' });
      const issued = await adapter.issueInvoice(command());
      const result = await adapter.getClearanceStatus(issued);
      expect(result.regulatoryStatus).toBe('rejected');
    });

    it('preserves an existing clearanceReference on the record', async () => {
      const adapter = makeAdapter().adapter;
      const issued = await adapter.issueInvoice(command());
      const withRef = new InvoiceRecord(
        issued.id,
        issued.connectionId,
        issued.orderId,
        issued.providerType,
        issued.documentType,
        issued.status,
        issued.providerInvoiceId,
        issued.providerInvoiceNumber,
        issued.regulatoryStatus,
        'KSEF-REF-123',
        issued.idempotencyKey,
        issued.pdfUrl,
        issued.issuedAt,
        issued.errorMessage,
        issued.createdAt,
        issued.updatedAt,
      );
      const result = await adapter.getClearanceStatus(withRef);
      expect(result.clearanceReference).toBe('KSEF-REF-123');
    });

    it('returns not-applicable without a bridge call when the record has no providerInvoiceId', async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'getInvoiceStatus');
      const record = new InvoiceRecord(
        'rec-1',
        'conn-1',
        'ol_order_1',
        SUBIEKT_PROVIDER_TYPE,
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
      expect(result.regulatoryStatus).toBe('not-applicable');
      expect(spy).not.toHaveBeenCalled();
    });

    it('[fake-only state] maps a fake { state: failed, regulatoryStatus: none } onto neutral not-applicable and warns (#1229)', async () => {
      const { adapter, logger } = makeAdapter();
      // FAKE-ONLY path: a non-null providerInvoiceId the in-memory fake never
      // issued reads back { state: 'failed', regulatoryStatus: 'none' } -> neutral
      // 'not-applicable' + a warn. The REAL bridge does NOT model an unknown id
      // this way — it returns a 4xx that the HTTP client surfaces as a thrown
      // SubiektInvoiceRejectedError (see the next test). Both are valid: the fake
      // exercises the soft-missing branch, the throw test the hard-rejection branch.
      const record = new InvoiceRecord(
        'rec-unknown',
        'conn-1',
        'ol_order_1',
        SUBIEKT_PROVIDER_TYPE,
        'invoice',
        'issued',
        '999999',
        'FV-UNKNOWN-1',
        'submitted',
        null,
        null,
        null,
        new Date(),
        null,
        new Date(),
        new Date(),
      );
      const result = await adapter.getClearanceStatus(record);
      // The warn surfaces the genuinely-missing document but does NOT change the
      // neutral result the caller acts on.
      expect(result.regulatoryStatus).toBe('not-applicable');
      expect(result.clearanceReference).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Subiekt bridge has no record for providerInvoiceId',
        expect.objectContaining({ providerInvoiceId: '999999' }),
      );
    });

    it('does NOT warn for a record the bridge knows (issued document)', async () => {
      const { adapter, logger } = makeAdapter();
      const issued = await adapter.issueInvoice(command());
      await adapter.getClearanceStatus(issued);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('translates a transport failure during a status read', async () => {
      const { adapter, bridge } = makeAdapter();
      const issued = await adapter.issueInvoice(command());
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.getClearanceStatus(issued)).rejects.toBeInstanceOf(
        SubiektBridgeTransportError,
      );
    });

    it('[real-bridge semantics] propagates a SubiektInvoiceRejectedError from the status read (does not swallow to not-applicable)', async () => {
      // The REAL SubiektBridgeHttpClient turns a bridge 4xx (e.g. an unknown
      // document id) into a thrown SubiektInvoiceRejectedError. The adapter must
      // PROPAGATE it (translateBridgeError passes it through) so the reconcile
      // service treats it as a read error — it must NOT swallow it into a neutral
      // 'not-applicable' the way the in-memory fake's soft-missing branch does.
      const { adapter, bridge } = makeAdapter();
      const issued = await adapter.issueInvoice(command());
      jest
        .spyOn(bridge, 'getInvoiceStatus')
        .mockRejectedValueOnce(new SubiektInvoiceRejectedError('unknown document id'));
      await expect(adapter.getClearanceStatus(issued)).rejects.toBeInstanceOf(
        SubiektInvoiceRejectedError,
      );
    });
  });
});
