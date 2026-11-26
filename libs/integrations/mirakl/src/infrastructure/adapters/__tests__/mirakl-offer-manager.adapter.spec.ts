/**
 * Mirakl Offer Manager Adapter: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import {
  isOfferFieldUpdater,
  isOfferLister,
  isOfferQuantityBatchUpdater,
  isOfferStatusReader,
  isPendingQuantityAckReconciler,
  OfferNotFoundOnMarketplaceException,
} from '@openlinker/core/listings';
import { MiraklUnsupportedFieldException } from '../../../domain/exceptions/mirakl-unsupported-field.exception';
import type { MiraklOfferWriteRepositoryPort } from '../../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklOffer } from '../../../domain/types/mirakl-offer.types';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { IMiraklImportTracker } from '../../imports/mirakl-import-tracker.interface';
import { MiraklOfferManagerAdapter } from '../mirakl-offer-manager.adapter';

/** Shaped like the OF21 answer for a real Empik staging offer. */
function stagingOffer(overrides: Partial<MiraklOffer> = {}): MiraklOffer {
  return {
    offer_id: 35223628,
    shop_sku: 'OL-TEST-HP1',
    product_sku: '1124653798',
    product_references: [{ reference: '9788380082113', reference_type: 'EAN' }],
    quantity: 5,
    price: 49.99,
    currency_iso_code: 'PLN',
    active: false,
    inactivity_reasons: ['NO_MIN_SHIPPING_RATE'],
    ...overrides,
  };
}

function setup(
  offers: MiraklOffer[] = [],
  total = offers.length
): {
  adapter: MiraklOfferManagerAdapter;
  get: jest.Mock;
  recordPending: jest.Mock;
} {
  const get = jest.fn().mockResolvedValue({ status: 200, data: { offers, total_count: total } });
  const recordPending = jest.fn().mockResolvedValue(undefined);
  const adapter = new MiraklOfferManagerAdapter({
    connectionId: 'conn-1',
    adapterKey: 'empik.mirakl.v1',
    brand: 'Empik',
    httpClient: { get } as unknown as IMiraklHttpClient,
    importTracker: {} as IMiraklImportTracker,
    writes: {
      recordPending,
      findLatest: jest.fn().mockResolvedValue(null),
    } as unknown as MiraklOfferWriteRepositoryPort,
    taxonomyOwner: 'empik',
  });
  return { adapter, get, recordPending };
}

describe('MiraklOfferManagerAdapter', () => {
  it('should be narrowed by every offer guard core uses', () => {
    const { adapter } = setup();

    expect(isOfferQuantityBatchUpdater(adapter)).toBe(true);
    expect(isPendingQuantityAckReconciler(adapter)).toBe(true);
    expect(isOfferLister(adapter)).toBe(true);
    expect(isOfferStatusReader(adapter)).toBe(true);
    expect(isOfferFieldUpdater(adapter)).toBe(true);
  });

  it('should record a batch of quantities and report every offer as accepted', async () => {
    const { adapter, recordPending } = setup();

    const result = await adapter.updateOfferQuantitiesBatch({
      items: [
        { offerId: 'SKU-1', quantity: 3 },
        { offerId: 'SKU-2', quantity: 0 },
      ],
    });

    expect(recordPending).toHaveBeenCalledWith('conn-1', 'stock', [
      { offerSku: 'SKU-1', value: '3' },
      { offerSku: 'SKU-2', value: '0' },
    ]);
    expect(result).toEqual({ succeeded: ['SKU-1', 'SKU-2'], failed: [] });
  });

  it('should record a price and nothing else', async () => {
    const { adapter, recordPending } = setup();

    await adapter.updateOfferFields({
      externalOfferId: 'SKU-1',
      fields: { price: { amount: '44.9', currency: 'PLN' } },
    });

    expect(recordPending).toHaveBeenCalledWith('conn-1', 'price', [
      { offerSku: 'SKU-1', value: '44.90', currency: 'PLN' },
    ]);
  });

  it('should refuse a title or description update rather than drop it silently', async () => {
    const { adapter, recordPending } = setup();

    await expect(
      adapter.updateOfferFields({ externalOfferId: 'SKU-1', fields: { title: 'New' } })
    ).rejects.toBeInstanceOf(MiraklUnsupportedFieldException);
    expect(recordPending).not.toHaveBeenCalled();
  });

  it('should list offers keyed by shop SKU with their EAN, and page by offset', async () => {
    const { adapter, get } = setup([stagingOffer()], 150);

    const page = await adapter.listOffers({ cursor: null, limit: 1 });

    expect(get).toHaveBeenCalledWith('/api/offers', { queryParams: { max: 1, offset: 0 } });
    expect(page).toEqual({
      items: [
        expect.objectContaining({
          offerId: 'OL-TEST-HP1',
          sku: 'OL-TEST-HP1',
          externalRef: 'OL-TEST-HP1',
          ean: '9788380082113',
        }),
      ],
      nextCursor: '1',
    });
  });

  it('should end the feed on the last page', async () => {
    const { adapter } = setup([stagingOffer()], 1);

    expect((await adapter.listOffers({ cursor: '0', limit: 100 })).nextCursor).toBeNull();
  });

  it('should read an inactive offer with its reasons and what the channel shows', async () => {
    const { adapter, get } = setup([stagingOffer()]);

    const status = await adapter.getOfferStatus('OL-TEST-HP1');

    expect(get).toHaveBeenCalledWith('/api/offers', { queryParams: { sku: 'OL-TEST-HP1' } });
    expect(status).toEqual({
      publicationStatus: 'inactive',
      validationErrors: [
        expect.objectContaining({ code: 'NO_MIN_SHIPPING_RATE', scope: 'account' }),
      ],
      commercial: { price: { amount: '49.99', currency: 'PLN' }, availableQuantity: 5 },
    });
  });

  it('should read an active offer with no problems', async () => {
    const { adapter } = setup([stagingOffer({ active: true, inactivity_reasons: [] })]);

    expect(await adapter.getOfferStatus('OL-TEST-HP1')).toMatchObject({
      publicationStatus: 'active',
      validationErrors: [],
    });
  });

  it('should report an offer Mirakl does not list as not found', async () => {
    const { adapter } = setup([]);

    await expect(adapter.getOfferStatus('GONE')).rejects.toBeInstanceOf(
      OfferNotFoundOnMarketplaceException
    );
  });

  describe('status of an offer OpenLinker just created (#4278)', () => {
    function withCreate(
      created: { status: string; importId: string; error?: string } | null,
      tracker: Partial<Record<'getStatus' | 'getErrorReport', jest.Mock>> = {},
    ): MiraklOfferManagerAdapter {
      return new MiraklOfferManagerAdapter({
        connectionId: 'conn-1',
        adapterKey: 'empik.mirakl.v1',
        brand: 'Empik',
        httpClient: {
          get: jest.fn().mockResolvedValue({ status: 200, data: { offers: [], total_count: 0 } }),
        } as unknown as IMiraklHttpClient,
        importTracker: tracker as unknown as IMiraklImportTracker,
        writes: {
          findLatest: jest.fn().mockResolvedValue(created),
        } as unknown as MiraklOfferWriteRepositoryPort,
        taxonomyOwner: 'empik',
      });
    }

    it('should read activating while the create import runs', async () => {
      const adapter = withCreate(
        { status: 'submitted', importId: '1' },
        { getStatus: jest.fn().mockResolvedValue({ state: 'pending', hasErrorReport: false }) },
      );

      expect(await adapter.getOfferStatus('OL-x')).toEqual({
        publicationStatus: 'activating',
        validationErrors: [],
      });
    });

    it('should read inactive with the import error once the import refused the offer', async () => {
      const adapter = withCreate(
        { status: 'submitted', importId: '1' },
        {
          getStatus: jest
            .fn()
            .mockResolvedValue({ state: 'done', linesInError: 1, hasErrorReport: true }),
          getErrorReport: jest
            .fn()
            .mockResolvedValue([{ sku: 'OL-x', reason: 'The product does not exist' }]),
        },
      );

      expect(await adapter.getOfferStatus('OL-x')).toEqual({
        publicationStatus: 'inactive',
        validationErrors: [
          { code: 'MIRAKL_OFFER_IMPORT_FAILED', message: 'The product does not exist' },
        ],
      });
    });

    it('should report not found for an offer OpenLinker did not create', async () => {
      await expect(withCreate(null).getOfferStatus('OL-x')).rejects.toBeInstanceOf(
        OfferNotFoundOnMarketplaceException,
      );
    });
  });
});
