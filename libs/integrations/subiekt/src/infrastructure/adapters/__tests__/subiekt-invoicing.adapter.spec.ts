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
  isBankAccountDefaultSetter,
  isBankAccountsReader,
  isCorrectionIssuer,
  isPaymentStatusReader,
  isRegulatoryRecordLocator,
  isRegulatoryStatusReader,
  MissingTaxRateException,
} from '@openlinker/core/invoicing';
import type {
  BuyerAddress,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  TaxIdentifier,
} from '@openlinker/core/invoicing';
import type { LoggerPort } from '@openlinker/shared/logging';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { InMemoryIdentifierMappingAdapter } from '@openlinker/core/identifier-mapping/testing';
import type { SubiektConnectionConfig } from '../../../domain/types/subiekt-connection-config.types';
import { FakeSubiektBridgeAdapter } from '../../../testing/fake-subiekt-bridge.adapter';
import {
  SubiektInvoicingAdapter,
  SUBIEKT_PROVIDER_TYPE,
} from '../subiekt-invoicing.adapter';
import { SubiektInvoiceRejectedError } from '../../../domain/exceptions/subiekt-invoice-rejected.exception';
import { SubiektBridgeTransportError } from '../../../domain/exceptions/subiekt-bridge-transport.exception';
import { SubiektUnsupportedDocumentTypeError } from '../../../domain/exceptions/subiekt-unsupported-document-type.exception';
import { SubiektConfigException } from '../../../domain/exceptions/subiekt-config.exception';

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

function makeAdapter(
  bridge = new FakeSubiektBridgeAdapter(),
  identifierMapping = new InMemoryIdentifierMappingAdapter(),
): {
  adapter: SubiektInvoicingAdapter;
  bridge: FakeSubiektBridgeAdapter;
  logger: LoggerPort;
  identifierMapping: InMemoryIdentifierMappingAdapter;
} {
  const logger = makeLogger();
  const adapter = new SubiektInvoicingAdapter(bridge, identifierMapping, 'conn-1', logger);
  return { adapter, bridge, logger, identifierMapping };
}

const BASE_CONFIG: SubiektConnectionConfig = { bridgeBaseUrl: 'http://localhost:5000' };

function makeConfiguredAdapter(
  config: Partial<SubiektConnectionConfig>,
  bridge = new FakeSubiektBridgeAdapter(),
): {
  adapter: SubiektInvoicingAdapter;
  bridge: FakeSubiektBridgeAdapter;
  logger: LoggerPort;
} {
  const logger = makeLogger();
  const adapter = new SubiektInvoicingAdapter(
    bridge,
    new InMemoryIdentifierMappingAdapter(),
    'conn-1',
    logger,
    {
      ...BASE_CONFIG,
      ...config,
    },
  );
  return { adapter, bridge, logger };
}

describe('SubiektInvoicingAdapter', () => {
  describe('the per-line tax-rate era reaches the line mapper (#2260 review)', () => {
    const withStrict = async (run: () => Promise<void>): Promise<void> => {
      const previous = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      process.env['OL_TAX_RATE_STRICT_ENABLED'] = 'true';
      try {
        await run();
      } finally {
        if (previous === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previous;
      }
    };

    it('issues a rate-less PRE-ROLLOUT order, keeping the documented default', async () => {
      await withStrict(async () => {
        const { adapter, bridge } = makeAdapter();
        const spy = jest.spyOn(bridge, 'issueInvoice');

        await adapter.issueInvoice(
          command({
            lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123.0, taxRate: '' }],
            taxRateEra: 'pre-rollout',
          }),
        );

        expect(spy.mock.calls[0]?.[0].lines[0]?.stawkaVAT).toBe('23');
      });
    });

    it('refuses the same rate-less order when it is NOT pre-rollout', async () => {
      await withStrict(async () => {
        const { adapter } = makeAdapter();
        await expect(
          adapter.issueInvoice(
            command({
              lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123.0, taxRate: '' }],
            }),
          ),
        ).rejects.toBeInstanceOf(MissingTaxRateException);
      });
    });
  });

  describe('issueInvoice', () => {
    it('builds a correct transient issued InvoiceRecord on success', async () => {
      const { adapter } = makeAdapter();
      const result = await adapter.issueInvoice(command());
      const record = result.record;
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
      const result = await adapter.issueInvoice(command());
      const record = result.record;
      expect(record.providerType).toBe(SUBIEKT_PROVIDER_TYPE);
      expect(SUBIEKT_PROVIDER_TYPE).toBe('subiekt-gt');
      // NEUTRAL, never the bridge-native 'faktura'.
      expect(record.documentType).toBe('invoice');
    });

    it('uses the receipt neutral type for a buyer with no nip', async () => {
      const { adapter } = makeAdapter();
      const result = await adapter.issueInvoice(command({ buyer: buyer(null) }));
      const record = result.record;
      expect(record.documentType).toBe('receipt');
    });

    it('maps the bridge regulatoryStatus onto the neutral value', async () => {
      const { adapter } = makeAdapter();
      // The fake returns regulatoryStatus 'sent' -> neutral 'submitted'.
      const result = await adapter.issueInvoice(command());
      const record = result.record;
      expect(record.regulatoryStatus).toBe('submitted');
    });

    it('echoes idempotencyKey onto the returned InvoiceRecord', async () => {
      const { adapter } = makeAdapter();
      const result = await adapter.issueInvoice(command({ idempotencyKey: 'idem-xyz' }));
      const record = result.record;
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

    describe('resolveZkId (order-number vs. order-id mismatch fix)', () => {
      it('resolves the ZK dok_Id via identifier_mappings and passes it as zkId', async () => {
        const { adapter, bridge, identifierMapping } = makeAdapter();
        identifierMapping.seed({
          entityType: CORE_ENTITY_TYPE.Order,
          externalId: '42', // the Subiekt ZK's numeric dok_Id, as a string
          connectionId: 'conn-1',
          internalId: 'ol_order_1', // matches command()'s default orderId
        });
        await adapter.issueInvoice(command());
        expect(bridge.getLastIssueInvoiceRequest()).toMatchObject({ zkId: 42 });
      });

      it('omits zkId when no mapping exists for the order (order-less/manual invoice, or pre-fix data)', async () => {
        const { adapter, bridge } = makeAdapter();
        await adapter.issueInvoice(command());
        expect(bridge.getLastIssueInvoiceRequest()).not.toHaveProperty('zkId');
      });

      it("ignores a mapping row that belongs to a DIFFERENT connection", async () => {
        const { adapter, bridge, identifierMapping } = makeAdapter();
        identifierMapping.seed({
          entityType: CORE_ENTITY_TYPE.Order,
          externalId: '42',
          connectionId: 'some-other-connection',
          internalId: 'ol_order_1',
        });
        await adapter.issueInvoice(command());
        expect(bridge.getLastIssueInvoiceRequest()).not.toHaveProperty('zkId');
      });

      it('omits zkId when the identifier-mapping lookup throws (fiscal-safe: never blocks issuance)', async () => {
        const { adapter, bridge, identifierMapping } = makeAdapter();
        jest.spyOn(identifierMapping, 'getExternalIds').mockRejectedValueOnce(new Error('db down'));
        const result = await adapter.issueInvoice(command());
        expect(result.record.status).toBe('issued');
        expect(bridge.getLastIssueInvoiceRequest()).not.toHaveProperty('zkId');
      });
    });

    describe('unlinkedCatalogueLines (free-text lines that never move stock)', () => {
      const linesFor = (...productIds: (string | undefined)[]): IssueInvoiceCommand['lines'] =>
        productIds.map((productId, i) => ({
          name: `Widget ${String(i)}`,
          quantity: 1,
          unitPriceGross: 10,
          taxRate: '23',
          ...(productId === undefined ? {} : { productId }),
        }));

      const seedProduct = (
        identifierMapping: InMemoryIdentifierMappingAdapter,
        internalId: string,
        symbol: string,
      ): void => {
        identifierMapping.seed({
          entityType: CORE_ENTITY_TYPE.Product,
          externalId: symbol,
          connectionId: 'conn-1',
          internalId,
        });
      };

      it('reports 0 when every line resolved to a catalogue symbol', async () => {
        const { adapter, identifierMapping } = makeAdapter();
        seedProduct(identifierMapping, 'ol_product_a', 'DZSO100');
        const result = await adapter.issueInvoice(
          command({ lines: linesFor('ol_product_a') }),
        );
        // Reported, not omitted: on this provider "all linked" is a real
        // answer, and `undefined` would read as "linkage not reported".
        expect(result.unlinkedCatalogueLines).toBe(0);
      });

      it('counts LINES, not distinct products', async () => {
        const { adapter } = makeAdapter();
        // One unmapped product on two lines is two lines the warehouse will
        // not see, and two lines is what the operator is looking at.
        const result = await adapter.issueInvoice(
          command({ lines: linesFor('ol_product_missing', 'ol_product_missing') }),
        );
        expect(result.unlinkedCatalogueLines).toBe(2);
      });

      it('counts only the unmapped lines on a mixed document', async () => {
        const { adapter, identifierMapping } = makeAdapter();
        seedProduct(identifierMapping, 'ol_product_a', 'DZSO100');
        const result = await adapter.issueInvoice(
          command({ lines: linesFor('ol_product_a', 'ol_product_missing') }),
        );
        expect(result.unlinkedCatalogueLines).toBe(1);
      });

      it('counts a line whose productId is the empty string', async () => {
        const { adapter } = makeAdapter();
        // It names a product and supplies no id for it, so it goes out
        // free-text exactly like an unmapped one. Reporting it as linked
        // would be the silent case this field exists to remove.
        const result = await adapter.issueInvoice(command({ lines: linesFor('') }));
        expect(result.unlinkedCatalogueLines).toBe(1);
      });

      it('does not count a line that carries no productId at all', async () => {
        const { adapter } = makeAdapter();
        // A shipping or hand-written line has no product to map; calling it
        // "unlinked" would put a permanent badge on every document.
        const result = await adapter.issueInvoice(command({ lines: linesFor(undefined) }));
        expect(result.unlinkedCatalogueLines).toBe(0);
      });

      it('still issues the document when nothing could be mapped', async () => {
        const { adapter, logger } = makeAdapter();
        const result = await adapter.issueInvoice(
          command({ lines: linesFor('ol_product_missing') }),
        );
        // The document is the operator's obligation; the badge is how they
        // learn the warehouse did not follow.
        expect(result.record.status).toBe('issued');
        expect(result.unlinkedCatalogueLines).toBe(1);
        expect(logger.warn).toHaveBeenCalled();
      });

      it('counts a line whose product is mapped on a DIFFERENT connection as unlinked', async () => {
        const { adapter, identifierMapping } = makeAdapter();
        identifierMapping.seed({
          entityType: CORE_ENTITY_TYPE.Product,
          externalId: 'DZSO100',
          connectionId: 'some-other-connection',
          internalId: 'ol_product_a',
        });
        expect(
          (await adapter.issueInvoice(command({ lines: linesFor('ol_product_a') })))
            .unlinkedCatalogueLines,
        ).toBe(1);
      });
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
      const result = await adapter.issueInvoice(
        command({ buyer: buyer({ scheme: 'pl-nip', value: '1234567890' }), documentType: 'receipt' }),
      );
      const record = result.record;
      expect(record.documentType).toBe('receipt');
      // Bridge-native document type: receipt -> 'PA' (paragon).
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'PA' }));
    });

    it("honours an explicit documentType 'invoice' through issueInvoice (maps to FV)", async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'issueInvoice');
      const result = await adapter.issueInvoice(command({ documentType: 'invoice' }));
      const record = result.record;
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
      const { record } = await adapter.issueCorrection(
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
      const { record } = await adapter.issueCorrection(correctionCommand({ idempotencyKey: 'idem-kor' }));
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
      const { record: def } = await adapter.issueCorrection(correctionCommand());
      expect(def.documentType).toBe('corrected');
      const { record: explicit } = await adapter.issueCorrection(
        correctionCommand({ documentType: 'credit-note' }),
      );
      expect(explicit.documentType).toBe('credit-note');
    });

    it("defaults regulatoryStatus to 'submitted' (the korekta response carries none)", async () => {
      const { adapter } = makeAdapter();
      const { record } = await adapter.issueCorrection(correctionCommand());
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

    // #3365 review — issueCorrection was returning no warehouseRelease signal
    // at all, unlike issueInvoice, even though the bridge has always answered
    // stockAutoReleased/quantityDeltas for this endpoint.
    describe('warehouseRelease (mirrors issueInvoice, #3365 review)', () => {
      it('reports released when Subiekt auto-released the stock movement', async () => {
        const { adapter, bridge } = makeAdapter();
        bridge.seedCorrection({ stockAutoReleased: true });
        const { warehouseRelease } = await adapter.issueCorrection(correctionCommand());
        expect(warehouseRelease).toEqual({ outcome: 'released', documentNumber: null });
      });

      it('reports not-applicable when nothing was due (no quantity deltas)', async () => {
        const { adapter, bridge } = makeAdapter();
        bridge.seedCorrection({ stockAutoReleased: false, quantityDeltas: [] });
        const { warehouseRelease } = await adapter.issueCorrection(
          correctionCommand({ lines: [{ originalLineNumber: 2, newUnitPriceGross: 80.5 }] }),
        );
        expect(warehouseRelease).toEqual({ outcome: 'not-applicable', documentNumber: null });
      });

      // THE ALARM: quantity changed and Subiekt did not auto-release — the
      // credit note is issued and the stock has not moved.
      it('reports not-released and logs an error when a release was due and Subiekt did not auto-apply it', async () => {
        const { adapter, bridge, logger } = makeAdapter();
        bridge.seedCorrection({
          stockAutoReleased: false,
          quantityDeltas: [{ lp: 1, delta: 2 }],
        });
        const { warehouseRelease } = await adapter.issueCorrection(correctionCommand());
        expect(warehouseRelease).toEqual({ outcome: 'not-released', documentNumber: null });
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('subiekt_correction_warehouse_release_missing'),
        );
      });

      // An older bridge build omits the field entirely — "not reported", never
      // a manufactured failure, mirroring readWarehouseRelease's same rule.
      it('reports nothing at all when the bridge omits the field', async () => {
        const { adapter } = makeAdapter();
        const { warehouseRelease } = await adapter.issueCorrection(correctionCommand());
        expect(warehouseRelease).toBeUndefined();
      });
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
      const result = await adapter.getClearanceStatus(issued.record);
      // 'sent' -> neutral 'submitted'.
      expect(result.regulatoryStatus).toBe('submitted');
    });

    it('maps a terminal accepted bridge status onto the neutral accepted', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seed({ regulatoryStatus: 'accepted' });
      const issued = await adapter.issueInvoice(command());
      const result = await adapter.getClearanceStatus(issued.record);
      expect(result.regulatoryStatus).toBe('accepted');
    });

    it('maps a terminal rejected bridge status onto the neutral rejected (data, not throw)', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seed({ regulatoryStatus: 'rejected' });
      const issued = await adapter.issueInvoice(command());
      const result = await adapter.getClearanceStatus(issued.record);
      expect(result.regulatoryStatus).toBe('rejected');
    });

    it('preserves an existing clearanceReference on the record', async () => {
      const adapter = makeAdapter().adapter;
      const issued = await adapter.issueInvoice(command());
      const withRef = new InvoiceRecord(
        issued.record.id,
        issued.record.connectionId,
        issued.record.orderId,
        issued.record.providerType,
        issued.record.documentType,
        issued.record.status,
        issued.record.providerInvoiceId,
        issued.record.providerInvoiceNumber,
        issued.record.regulatoryStatus,
        'KSEF-REF-123',
        issued.record.idempotencyKey,
        issued.record.pdfUrl,
        issued.record.issuedAt,
        issued.record.errorMessage,
        issued.record.createdAt,
        issued.record.updatedAt,
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
      await adapter.getClearanceStatus(issued.record);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('translates a transport failure during a status read', async () => {
      const { adapter, bridge } = makeAdapter();
      const issued = await adapter.issueInvoice(command());
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.getClearanceStatus(issued.record)).rejects.toBeInstanceOf(
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
      await expect(adapter.getClearanceStatus(issued.record)).rejects.toBeInstanceOf(
        SubiektInvoiceRejectedError,
      );
    });
  });

  describe('locateByQuery (#3389, RegulatoryRecordLocator crash-recovery)', () => {
    it('is detected as a RegulatoryRecordLocator', () => {
      const adapter = makeAdapter().adapter;
      expect(isRegulatoryRecordLocator(adapter)).toBe(true);
    });

    it('finds a previously-issued document by idempotencyKey and maps it to a neutral result', async () => {
      const { adapter } = makeAdapter();
      const issued = await adapter.issueInvoice(command({ idempotencyKey: 'invoice:conn-1:order-1' }));
      const located = await adapter.locateByQuery({ idempotencyKey: 'invoice:conn-1:order-1' });
      expect(located).not.toBeNull();
      expect(located?.providerInvoiceId).toBe(issued.record.providerInvoiceId);
      expect(located?.regulatoryStatus).toBe('submitted'); // fake seeds 'sent' -> neutral 'submitted'
    });

    it('returns null when nothing was issued under the given idempotencyKey', async () => {
      const { adapter } = makeAdapter();
      const located = await adapter.locateByQuery({ idempotencyKey: 'never-issued-key' });
      expect(located).toBeNull();
    });

    it('returns null without a bridge call when the criteria carries no idempotencyKey (Subiekt cannot search by documentNumber pre-crash)', async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'locateByOriginalKey');
      const located = await adapter.locateByQuery({
        documentNumber: 'FV/2026/1',
        issuedFrom: new Date(),
        issuedTo: new Date(),
      });
      expect(located).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    it('translates a transport failure during the locate call', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('bridge-unreachable');
      await expect(
        adapter.locateByQuery({ idempotencyKey: 'some-key' }),
      ).rejects.toBeInstanceOf(SubiektBridgeTransportError);
    });
  });

  describe('getPaymentStatus (#3390, PaymentStatusReader)', () => {
    it('is detected as a PaymentStatusReader', () => {
      const adapter = makeAdapter().adapter;
      expect(isPaymentStatusReader(adapter)).toBe(true);
    });

    it('reads unpaid for a freshly-issued document', async () => {
      const { adapter } = makeAdapter();
      const issued = await adapter.issueInvoice(command());
      const result = await adapter.getPaymentStatus(issued.record);
      expect(result.paymentStatus).toBe('unpaid');
    });

    it('reads paid once the bridge is seeded as settled', async () => {
      const { adapter, bridge } = makeAdapter();
      const issued = await adapter.issueInvoice(command());
      bridge.seedPaid(Number(issued.record.providerInvoiceId));
      const result = await adapter.getPaymentStatus(issued.record);
      expect(result.paymentStatus).toBe('paid');
    });

    it('returns unknown without a bridge call when the record has no providerInvoiceId', async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'getInvoiceStatus');
      const record = new InvoiceRecord(
        'rec-pending',
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
      const result = await adapter.getPaymentStatus(record);
      expect(result.paymentStatus).toBe('unknown');
      expect(spy).not.toHaveBeenCalled();
    });

    it('translates a transport failure during a payment-status read', async () => {
      const { adapter, bridge } = makeAdapter();
      const issued = await adapter.issueInvoice(command());
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.getPaymentStatus(issued.record)).rejects.toBeInstanceOf(
        SubiektBridgeTransportError,
      );
    });
  });

  describe('bank-account discovery (#1324)', () => {
    it('is detected as a BankAccountsReader and BankAccountDefaultSetter', () => {
      const { adapter } = makeAdapter();
      expect(isBankAccountsReader(adapter)).toBe(true);
      expect(isBankAccountDefaultSetter(adapter)).toBe(true);
    });

    it('listBankAccounts maps the bridge shape to the neutral type and DROPS owner fields', async () => {
      const { adapter } = makeAdapter();
      const accounts = await adapter.listBankAccounts();
      // The fake seeds 3 default accounts (two owner=1, one owner=2).
      expect(accounts).toEqual([
        {
          id: '100004',
          accountNumber: '00 10101010 1111 1111 1111 1111',
          bankName: 'Rachunek podstawowy',
          isDefault: true,
        },
        {
          id: '100007',
          accountNumber: '00 10101010 2222 2222 2222 2222',
          bankName: 'Rachunek VAT',
          isDefault: false,
        },
        {
          id: '100011',
          accountNumber: '00 10101010 3333 3333 3333 3333',
          bankName: 'Rachunek oddziału',
          isDefault: false,
        },
      ]);
      // Owner fields are not part of the neutral shape.
      expect(accounts[0]).not.toHaveProperty('ownerPodmiotId');
      expect(accounts[0]).not.toHaveProperty('ownerName');
    });

    it('listBankAccounts degrades null name/number to empty strings', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedBankAccounts([
        {
          id: 500,
          name: null,
          number: null,
          bankNumber: null,
          description: null,
          currency: null,
          isVatAccount: false,
          isDefault: false,
          ownerPodmiotId: 1,
          ownerName: null,
        },
      ]);
      const accounts = await adapter.listBankAccounts();
      expect(accounts).toEqual([
        { id: '500', accountNumber: '', bankName: '', isDefault: false },
      ]);
    });

    it('listBankAccountsWithOwner KEEPS the owner fields', async () => {
      const { adapter } = makeAdapter();
      const accounts = await adapter.listBankAccountsWithOwner();
      expect(accounts).toEqual([
        {
          id: '100004',
          accountNumber: '00 10101010 1111 1111 1111 1111',
          bankName: 'Rachunek podstawowy',
          isDefault: true,
          ownerPodmiotId: 1,
          ownerName: 'Moja Firma Sp. z o.o.',
        },
        {
          id: '100007',
          accountNumber: '00 10101010 2222 2222 2222 2222',
          bankName: 'Rachunek VAT',
          isDefault: false,
          ownerPodmiotId: 1,
          ownerName: 'Moja Firma Sp. z o.o.',
        },
        {
          id: '100011',
          accountNumber: '00 10101010 3333 3333 3333 3333',
          bankName: 'Rachunek oddziału',
          isDefault: false,
          ownerPodmiotId: 2,
          ownerName: 'Oddział Handlowy Sp. z o.o.',
        },
      ]);
    });

    it('setDefaultBankAccount calls the bridge with Number(accountId)', async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'setDefaultBankAccount');
      await adapter.setDefaultBankAccount('100007');
      expect(spy).toHaveBeenCalledWith(100007);
    });

    it('setDefaultBankAccount rejects a non-numeric id before hitting the bridge', async () => {
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'setDefaultBankAccount');
      await expect(adapter.setDefaultBankAccount('not-a-number')).rejects.toBeInstanceOf(
        SubiektConfigException,
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('listBankAccounts propagates a translated transport error', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.listBankAccounts()).rejects.toBeInstanceOf(SubiektBridgeTransportError);
    });

    it('listBankAccountsWithOwner propagates a translated transport error', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.listBankAccountsWithOwner()).rejects.toBeInstanceOf(
        SubiektBridgeTransportError,
      );
    });

    it('setDefaultBankAccount translates a subiekt-rejected error (terminal)', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('subiekt-rejected', { reason: 'unknown account' });
      await expect(adapter.setDefaultBankAccount('999')).rejects.toBeInstanceOf(
        SubiektInvoiceRejectedError,
      );
    });
  });

  describe('cash-register discovery (#1324)', () => {
    it('listCashRegisters maps the bridge shape incl. linked + unlinked (null oddzialId)', async () => {
      const { adapter } = makeAdapter();
      const registers = await adapter.listCashRegisters();
      expect(registers).toEqual([
        { id: 100065, name: 'Kasa Centralna', symbol: 'CENTR', oddzialId: null },
        { id: 100066, name: 'Kasa Outlet', symbol: 'OUTLET', oddzialId: null },
        { id: 100067, name: 'Kasa Pachnidło', symbol: 'PACH', oddzialId: 100001 },
      ]);
    });

    it('listCashRegisters degrades null name/symbol gracefully', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedCashRegisters([{ id: 9, name: null, symbol: null, oddzialId: null }]);
      const registers = await adapter.listCashRegisters();
      expect(registers).toEqual([{ id: 9, name: null, symbol: null, oddzialId: null }]);
    });

    it('listCashRegisters propagates a translated transport error', async () => {
      const { adapter, bridge } = makeAdapter();
      bridge.seedFailure('bridge-unreachable');
      await expect(adapter.listCashRegisters()).rejects.toBeInstanceOf(SubiektBridgeTransportError);
    });
  });

  // A Subiekt MODEL is ONE OL product standing for several towary, so its
  // product-level external id is `model:{mdt_Id}` - a grouping key, not a
  // `tw_Symbol`. Sending it reaches `d.Pozycje.Dodaj("model:5")` bridge-side,
  // inside a try that carries no catch, so the whole issuance fails with a raw
  // COM message. It never looked unmapped either: the mapping exists and is
  // non-empty, so nothing warned and nothing counted it.
  describe('a model product names its towar through the variant (#3365)', () => {
    async function capturedLines(
      cmd: IssueInvoiceCommand,
      idMapping: InMemoryIdentifierMappingAdapter,
    ): Promise<{ name: string; towarSymbol?: string }[]> {
      const { adapter, bridge } = makeAdapter(new FakeSubiektBridgeAdapter(), idMapping);
      const spy = jest.spyOn(bridge, 'issueInvoice');
      await adapter.issueInvoice(cmd);
      return (spy.mock.calls[0][0] as unknown as { lines: { name: string; towarSymbol?: string }[] })
        .lines;
    }

    function seedModel(idMapping: InMemoryIdentifierMappingAdapter): void {
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: 'model:5',
        connectionId: 'conn-1',
        internalId: 'ol_product_model',
      });
    }

    it('sends the towar symbol, never the model grouping key', async () => {
      const idMapping = new InMemoryIdentifierMappingAdapter();
      seedModel(idMapping);
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: 'WOBLACK100::variant',
        connectionId: 'conn-1',
        internalId: 'ol_variant_1',
      });

      const lines = await capturedLines(
        command({
          lines: [
            {
              name: 'Black Tiger 100ml',
              quantity: 1,
              unitPriceGross: 551.02,
              taxRate: '23',
              productId: 'ol_product_model',
              variantId: 'ol_variant_1',
            },
          ],
        }),
        idMapping,
      );

      expect(lines[0].towarSymbol).toBe('WOBLACK100');
      expect(lines[0].towarSymbol).not.toContain('model:');
    });

    // Two members of ONE model share a productId and are different towary. A
    // product-keyed symbol map gave them both whichever resolved last.
    it('gives each member of one model its OWN symbol', async () => {
      const idMapping = new InMemoryIdentifierMappingAdapter();
      seedModel(idMapping);
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: 'WOBLACK100::variant',
        connectionId: 'conn-1',
        internalId: 'ol_variant_1',
      });
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: 'WOBLACK50::variant',
        connectionId: 'conn-1',
        internalId: 'ol_variant_2',
      });

      const lines = await capturedLines(
        command({
          lines: [
            {
              name: '100ml',
              quantity: 1,
              unitPriceGross: 551.02,
              taxRate: '23',
              productId: 'ol_product_model',
              variantId: 'ol_variant_1',
            },
            {
              name: '50ml',
              quantity: 1,
              unitPriceGross: 309.94,
              taxRate: '23',
              productId: 'ol_product_model',
              variantId: 'ol_variant_2',
            },
          ],
        }),
        idMapping,
      );

      expect(lines.map((l) => l.towarSymbol)).toEqual(['WOBLACK100', 'WOBLACK50']);
    });

    // Without a resolvable towar the line goes out free-text, which is the
    // documented degradation - the document still issues and the operator sees
    // the count. What must NOT happen is the grouping key reaching the bridge.
    it('falls back to a free-text line when the variant names no towar', async () => {
      const idMapping = new InMemoryIdentifierMappingAdapter();
      seedModel(idMapping);

      const lines = await capturedLines(
        command({
          lines: [
            {
              name: 'Black Tiger 100ml',
              quantity: 1,
              unitPriceGross: 551.02,
              taxRate: '23',
              productId: 'ol_product_model',
            },
          ],
        }),
        idMapping,
      );

      expect(lines[0].towarSymbol).toBeUndefined();
    });

    // An ordinary towar is untouched by any of this.
    it('leaves a non-model product resolving through its own mapping', async () => {
      const idMapping = new InMemoryIdentifierMappingAdapter();
      idMapping.seed({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: 'SYM-1',
        connectionId: 'conn-1',
        internalId: 'ol_product_x',
      });

      const lines = await capturedLines(
        command({
          lines: [
            {
              name: 'Widget',
              quantity: 1,
              unitPriceGross: 123.0,
              taxRate: '23',
              productId: 'ol_product_x',
            },
          ],
        }),
        idMapping,
      );

      expect(lines[0].towarSymbol).toBe('SYM-1');
    });
  });

  describe('issueInvoice payment + cash-register field stamping (#1324)', () => {
    async function capturedRequest(
      config: Partial<SubiektConnectionConfig>,
    ): Promise<Record<string, unknown>> {
      const { adapter, bridge } = makeConfiguredAdapter(config);
      const spy = jest.spyOn(bridge, 'issueInvoice');
      await adapter.issueInvoice(command());
      return spy.mock.calls[0][0] as unknown as Record<string, unknown>;
    }

    it('(a) no config -> request carries NONE of the new keys (no regression)', async () => {
      // Baseline built from the plain 3-arg adapter — proves an unconfigured
      // connection sends a byte-identical request to the pre-#1324 behavior.
      const { adapter, bridge } = makeAdapter();
      const spy = jest.spyOn(bridge, 'issueInvoice');
      await adapter.issueInvoice(command());
      const req = spy.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(req).not.toHaveProperty('paymentMethod');
      expect(req).not.toHaveProperty('bankAccountId');
      expect(req).not.toHaveProperty('stanowiskoKasoweId');
    });

    it('(a2) empty config object -> request carries NONE of the new keys', async () => {
      const req = await capturedRequest({});
      expect(req).not.toHaveProperty('paymentMethod');
      expect(req).not.toHaveProperty('bankAccountId');
      expect(req).not.toHaveProperty('stanowiskoKasoweId');
    });

    it('(b) cash -> { paymentMethod: cash } only', async () => {
      const req = await capturedRequest({ defaultPaymentMethod: 'cash' });
      expect(req.paymentMethod).toBe('cash');
      expect(req).not.toHaveProperty('bankAccountId');
    });

    it('(b2) cash ignores a configured bankAccountId', async () => {
      const req = await capturedRequest({ defaultPaymentMethod: 'cash', bankAccountId: 100007 });
      expect(req.paymentMethod).toBe('cash');
      expect(req).not.toHaveProperty('bankAccountId');
    });

    it('(c) transfer + account -> both payment keys', async () => {
      const req = await capturedRequest({
        defaultPaymentMethod: 'transfer',
        bankAccountId: 100007,
      });
      expect(req.paymentMethod).toBe('transfer');
      expect(req.bankAccountId).toBe(100007);
    });

    it('(d) transfer without an account -> neither payment key (fiscal-safe)', async () => {
      const req = await capturedRequest({ defaultPaymentMethod: 'transfer' });
      expect(req).not.toHaveProperty('paymentMethod');
      expect(req).not.toHaveProperty('bankAccountId');
    });

    it('(d2) transfer without an account warns about the half-configured state', async () => {
      const { adapter, logger } = makeConfiguredAdapter({ defaultPaymentMethod: 'transfer' });
      await adapter.issueInvoice(command());
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('transfer payment but has no bankAccountId'),
        expect.objectContaining({ connectionId: 'conn-1' }),
      );
    });

    it('(e) register set -> { stanowiskoKasoweId }', async () => {
      const req = await capturedRequest({ defaultStanowiskoKasoweId: 100067 });
      expect(req.stanowiskoKasoweId).toBe(100067);
    });

    it('(f) register unset -> no stanowiskoKasoweId key', async () => {
      const req = await capturedRequest({ defaultPaymentMethod: 'cash' });
      expect(req).not.toHaveProperty('stanowiskoKasoweId');
    });

    it('payment and cash-register fields combine on one request', async () => {
      const req = await capturedRequest({
        defaultPaymentMethod: 'transfer',
        bankAccountId: 100007,
        defaultStanowiskoKasoweId: 100067,
      });
      expect(req.paymentMethod).toBe('transfer');
      expect(req.bankAccountId).toBe(100007);
      expect(req.stanowiskoKasoweId).toBe(100067);
    });
  });
});

/**
 * The warehouse release the bridge always answered and OpenLinker threw away
 * (#3365 audit).
 *
 * A repo-wide search for `warehouseReleaseNumber` found a type declaration,
 * three specs, and no production reader - while `resolveZkId` returns `null` on
 * two paths and the bridge's own fallback for that case is documented in this
 * adapter as never matching a natural order. So an invoice could issue with the
 * correct money while the stock never left, and the only way to notice was to
 * open Subiekt.
 *
 * The four states are asserted, because three of them are quiet and correct and
 * only one is the alarm.
 */
describe('SubiektInvoicingAdapter — the warehouse release', () => {
  type Release = { outcome: string; documentNumber: string | null } | undefined;

  /**
   * `zkMapped` is what decides the two silent states apart: the adapter passes
   * a `zkId` only when the order carries a Subiekt `Order` mapping, so seeding
   * one is what makes a release DUE.
   */
  function buildWarehouseReleaseHarness(input: {
    warehouseReleaseNumber?: string | null;
    zkMapped: boolean;
  }): { adapter: SubiektInvoicingAdapter; cmd: IssueInvoiceCommand; logger: LoggerPort } {
    const bridge = new FakeSubiektBridgeAdapter();
    if (input.warehouseReleaseNumber !== undefined) {
      bridge.seed({ warehouseReleaseNumber: input.warehouseReleaseNumber });
    }
    const identifierMapping = new InMemoryIdentifierMappingAdapter();
    const logger = makeLogger();
    const adapter = new SubiektInvoicingAdapter(bridge, identifierMapping, 'conn-1', logger);
    const cmd = command();
    if (input.zkMapped) {
      void identifierMapping.createMapping('Order', '4242', 'conn-1', cmd.orderId);
    }
    return { adapter, cmd, logger };
  }

  function readRelease(
    adapter: { issueInvoice: (cmd: never) => Promise<{ warehouseRelease?: unknown }> },
    cmd: unknown,
  ): Promise<Release> {
    return adapter.issueInvoice(cmd as never).then((r) => r.warehouseRelease as Release);
  }

  it('reports released, with the number, when the bridge names a WZ', async () => {
    const { adapter, cmd } = buildWarehouseReleaseHarness({
      warehouseReleaseNumber: 'WZ 67/2026',
      zkMapped: true,
    });
    await expect(readRelease(adapter, cmd)).resolves.toEqual({
      outcome: 'released',
      documentNumber: 'WZ 67/2026',
    });
  });

  // Quiet and correct: a manually issued, order-less invoice has nothing to
  // release, and the bridge's `null` says exactly that.
  it('reports not-applicable when no order document was handed over', async () => {
    const { adapter, cmd } = buildWarehouseReleaseHarness({
      warehouseReleaseNumber: null,
      zkMapped: false,
    });
    await expect(readRelease(adapter, cmd)).resolves.toEqual({
      outcome: 'not-applicable',
      documentNumber: null,
    });
  });

  // THE ALARM. The same `null` on a real sale means the release did not happen:
  // the client is billed and the stock has not moved.
  it('reports not-released when a ZK was handed over and no WZ came back', async () => {
    const { adapter, cmd, logger } = buildWarehouseReleaseHarness({
      warehouseReleaseNumber: null,
      zkMapped: true,
    });
    await expect(readRelease(adapter, cmd)).resolves.toEqual({
      outcome: 'not-released',
      documentNumber: null,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('subiekt_warehouse_release_missing'),
    );
  });

  // An older bridge omits the field entirely. "Not reported" is the truthful
  // answer, never a manufactured failure.
  it('reports nothing at all when the bridge omits the field', async () => {
    const { adapter, cmd } = buildWarehouseReleaseHarness({ zkMapped: true });
    await expect(readRelease(adapter, cmd)).resolves.toBeUndefined();
  });
});

describe('unlinkedCatalogueLines for a MODEL product (#3365 review)', () => {
  it('counts only the sibling line whose variant failed to resolve, not both', async () => {
    // A Subiekt model is ONE OL product standing for several towary, so two of
    // its members on one document share a `productId` and differ only by
    // `variantId`. The resolver keys on the variant; the unmapped set used to
    // record the bare PRODUCT, so one unresolved variant marked BOTH lines
    // unlinked - over-reporting a line that was linked perfectly well.
    const { adapter, identifierMapping } = makeAdapter();
    // The product resolves to a MODEL grouping, which is never a towar, so each
    // line falls through to its own variant - which is the shape that exposes
    // the bug.
    identifierMapping.seed({
      entityType: CORE_ENTITY_TYPE.Product,
      externalId: 'model:5',
      connectionId: 'conn-1',
      internalId: 'ol_product_model',
    });
    // Variant A has a towar; variant B has none.
    identifierMapping.seed({
      entityType: CORE_ENTITY_TYPE.ProductVariant,
      externalId: 'TOWAR-A',
      connectionId: 'conn-1',
      internalId: 'ol_variant_a',
    });

    const result = await adapter.issueInvoice(
      command({
        lines: [
          {
            name: 'A',
            quantity: 1,
            unitPriceGross: 10,
            taxRate: '23',
            productId: 'ol_product_model',
            variantId: 'ol_variant_a',
          },
          {
            name: 'B',
            quantity: 1,
            unitPriceGross: 10,
            taxRate: '23',
            productId: 'ol_product_model',
            variantId: 'ol_variant_b',
          },
        ],
      }),
    );

    expect(result.unlinkedCatalogueLines).toBe(1);
  });
});
