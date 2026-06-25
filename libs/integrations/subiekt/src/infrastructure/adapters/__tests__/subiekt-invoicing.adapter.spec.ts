/**
 * Subiekt Invoicing Adapter — unit tests (#753)
 *
 * Driven against FakeSubiektBridgeAdapter (never real HTTP). Covers issuance
 * success, error translation, getInvoice no-ops, doctype discovery, and the
 * idempotency / retryability obligations.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { BuyerProfile, InvoiceRecord, isRegulatoryStatusReader } from '@openlinker/core/invoicing';
import type {
  BuyerAddress,
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

function makeLogger(): LoggerPort {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeAdapter(bridge = new FakeSubiektBridgeAdapter()): {
  adapter: SubiektInvoicingAdapter;
  bridge: FakeSubiektBridgeAdapter;
} {
  const adapter = new SubiektInvoicingAdapter(bridge, 'conn-1', makeLogger());
  return { adapter, bridge };
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
      await expect(adapter.issueInvoice(command())).rejects.toBeInstanceOf(
        SubiektInvoiceRejectedError,
      );
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
    it('routes a credit-note through the bridge correction endpoint, not the issue endpoint', async () => {
      const { adapter, bridge } = makeAdapter();
      const issueSpy = jest.spyOn(bridge, 'issueInvoice');
      const correctionSpy = jest.spyOn(bridge, 'issueCorrection');
      const record = await adapter.issueInvoice(command({ documentType: 'credit-note' }));
      expect(correctionSpy).toHaveBeenCalledTimes(1);
      expect(issueSpy).not.toHaveBeenCalled();
      // Bridge-native correction document type: FK (faktura korygująca).
      expect(correctionSpy).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'FK' }));
      expect(record.status).toBe('issued');
      // Preserves the caller's neutral correction doctype.
      expect(record.documentType).toBe('credit-note');
      // Distinct correction id space (300_000+).
      expect(record.providerInvoiceId).toBe('300001');
      expect(record.providerInvoiceNumber).toBe('FK-MOCK-001');
    });

    it("routes a 'corrected' doctype through the correction endpoint too", async () => {
      const { adapter, bridge } = makeAdapter();
      const correctionSpy = jest.spyOn(bridge, 'issueCorrection');
      const record = await adapter.issueInvoice(command({ documentType: 'corrected' }));
      expect(correctionSpy).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'FK' }));
      expect(record.documentType).toBe('corrected');
    });

    it('passes the command idempotencyKey to the correction endpoint', async () => {
      const { adapter, bridge } = makeAdapter();
      const correctionSpy = jest.spyOn(bridge, 'issueCorrection');
      await adapter.issueInvoice(command({ documentType: 'credit-note', idempotencyKey: 'idem-kor' }));
      expect(correctionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'idem-kor' }),
      );
    });

    it('maps the bridge regulatoryStatus on a correction onto the neutral value', async () => {
      const { adapter } = makeAdapter();
      // The fake returns regulatoryStatus 'sent' -> neutral 'submitted'.
      const record = await adapter.issueInvoice(command({ documentType: 'credit-note' }));
      expect(record.regulatoryStatus).toBe('submitted');
    });

    it("translates a failed correction (state:'failed') -> SubiektInvoiceRejectedError", async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seed({ state: 'failed' });
      await expect(
        adapter.issueInvoice(command({ documentType: 'credit-note' })),
      ).rejects.toBeInstanceOf(SubiektInvoiceRejectedError);
    });

    it('translates a correction transport failure -> SubiektBridgeTransportError', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('bridge-unreachable');
      await expect(
        adapter.issueInvoice(command({ documentType: 'credit-note' })),
      ).rejects.toBeInstanceOf(SubiektBridgeTransportError);
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

    it('translates a transport failure during a status read', async () => {
      const { adapter, bridge } = makeAdapter();
      const issued = await adapter.issueInvoice(command());
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.getClearanceStatus(issued)).rejects.toBeInstanceOf(
        SubiektBridgeTransportError,
      );
    });
  });
});
