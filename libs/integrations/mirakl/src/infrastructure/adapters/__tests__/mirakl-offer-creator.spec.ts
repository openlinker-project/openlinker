/**
 * Mirakl Offer Creator: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { OfferCreateRejectedException, type CreateOfferCommand } from '@openlinker/core/listings';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import type { MiraklOfferWriteRepositoryPort } from '../../../domain/ports/mirakl-offer-write-repository.port';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { MiraklCatalog } from '../mirakl-catalog';
import { MiraklOfferCreator } from '../mirakl-offer-creator';

const VARIANT = 'ol_variant_e4b98e91340a44edb4892905db8810b1';
const SHOP_SKU = 'OL-e4b98e91340a44edb4892905db8810b1';

function command(overrides: Partial<CreateOfferCommand> = {}): CreateOfferCommand {
  return {
    internalVariantId: VARIANT,
    connectionId: 'conn-1',
    price: { amount: 49.9, currency: 'PLN' },
    stock: 5,
    publishImmediately: true,
    variantBarcode: '9788380082113',
    ...overrides,
  };
}

function setup(cards: Array<{ product_sku: string }> = [{ product_sku: '1124653798' }]): {
  creator: MiraklOfferCreator;
  post: jest.Mock;
  recordSubmitted: jest.Mock;
} {
  const post = jest.fn().mockResolvedValue({ status: 201, data: { import_id: 2156101 } });
  const recordSubmitted = jest.fn().mockResolvedValue(undefined);
  const catalog = {
    findCards: jest.fn().mockResolvedValue(new Map([['9788380082113', cards]])),
  } as unknown as MiraklCatalog;
  const creator = new MiraklOfferCreator({
    connectionId: 'conn-1',
    adapterKey: 'empik.mirakl.v1',
    brand: 'Empik',
    httpClient: { post } as unknown as IMiraklHttpClient,
    catalog,
    writes: () => ({ recordSubmitted }) as unknown as MiraklOfferWriteRepositoryPort,
    offerDefaults: { leadTimeToShip: 2, logisticClass: '1' },
  });
  return { creator, post, recordSubmitted };
}

async function rejection(promise: Promise<unknown>): Promise<string[]> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OfferCreateRejectedException);
  return (error as OfferCreateRejectedException).errors.map((entry) => entry.code);
}

describe('MiraklOfferCreator', () => {
  it('should create the offer on the existing card with the full OF24 field set', async () => {
    const { creator, post, recordSubmitted } = setup();

    const result = await creator.createOffer(
      command({
        gpsr: { producer: { name: 'Media Rodzina' } },
        overrides: { platformParams: { leadTimeToShip: 3 } },
      })
    );

    expect(post).toHaveBeenCalledWith('/api/offers', {
      offers: [
        {
          shop_sku: SHOP_SKU,
          product_id: '9788380082113',
          product_id_type: 'EAN',
          price: '49.90',
          quantity: 5,
          state_code: '11',
          update_delete: 'update',
          leadtime_to_ship: 3,
          logistic_class: '1',
          offer_additional_fields: [
            { code: 'gpsr-manufacturer-entity-name', value: 'Media Rodzina' },
          ],
        },
      ],
    });
    expect(recordSubmitted).toHaveBeenCalledWith(
      'conn-1',
      'offer',
      [{ offerSku: SHOP_SKU, value: '49.90' }],
      '2156101'
    );
    expect(result).toEqual({ externalOfferId: SHOP_SKU, status: 'validating' });
  });

  it('should refuse a product with no card, without calling OF24', async () => {
    const { creator, post } = setup([]);

    expect(await rejection(creator.createOffer(command()))).toEqual([
      'MIRAKL_PRODUCT_CARD_MISSING',
    ]);
    expect(post).not.toHaveBeenCalled();
  });

  it('should refuse a variant without an EAN', async () => {
    const { creator } = setup();

    expect(await rejection(creator.createOffer(command({ variantBarcode: null })))).toEqual([
      'EAN_REQUIRED',
    ]);
  });

  it('should require a lead time and a logistic class from the batch or the connection', async () => {
    const post = jest.fn();
    const creator = new MiraklOfferCreator({
      connectionId: 'conn-1',
      adapterKey: 'empik.mirakl.v1',
      brand: 'Empik',
      httpClient: { post } as unknown as IMiraklHttpClient,
      catalog: { findCards: jest.fn() } as unknown as MiraklCatalog,
      writes: (): MiraklOfferWriteRepositoryPort => ({}) as MiraklOfferWriteRepositoryPort,
      offerDefaults: {},
    });

    expect(await rejection(creator.createOffer(command()))).toEqual([
      'LEAD_TIME_REQUIRED',
      'LOGISTIC_CLASS_REQUIRED',
    ]);
    expect(post).not.toHaveBeenCalled();
  });

  it('should turn a Mirakl refusal into a rejected create', async () => {
    const { creator, post } = setup();
    post.mockRejectedValueOnce(new MiraklApiException('bad', 400));

    expect(await rejection(creator.createOffer(command()))).toEqual([
      'MIRAKL_OFFER_IMPORT_REFUSED',
    ]);
  });
});
