/**
 * Mirakl Offer Creator: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import {
  OfferCreateRejectedException,
  type CategoryParameter,
  type CreateOfferCommand,
} from '@openlinker/core/listings';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklAuthenticationException } from '../../../domain/exceptions/mirakl-authentication.exception';
import type { MiraklOfferWriteRepositoryPort } from '../../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklCardRequest } from '../../../domain/types/mirakl-card.types';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { MiraklCatalog } from '../mirakl-catalog';
import { MiraklOfferCreator } from '../mirakl-offer-creator';
import { empikOperatorProfile } from '../../../operators/empik.profile';

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
  readCards: jest.Mock;
} {
  const post = jest.fn().mockResolvedValue({ status: 201, data: { import_id: 2156101 } });
  const recordSubmitted = jest.fn().mockResolvedValue(undefined);
  const readCards = jest.fn().mockResolvedValue(new Map([['9788380082113', cards]]));
  const catalog = { readCards } as unknown as MiraklCatalog;
  const creator = new MiraklOfferCreator({
    connectionId: 'conn-1',
    adapterKey: 'empik.mirakl.v1',
    brand: 'Empik',
    httpClient: { post } as unknown as IMiraklHttpClient,
    catalog,
    writes: () => ({ recordSubmitted }) as unknown as MiraklOfferWriteRepositoryPort,
    offerDefaults: { leadTimeToShip: 2, logisticClass: '1' },
    cardAttributes: empikOperatorProfile.cardAttributes,
  });
  return { creator, post, recordSubmitted, readCards };
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
      catalog: { readCards: jest.fn() } as unknown as MiraklCatalog,
      writes: (): MiraklOfferWriteRepositoryPort => ({}) as MiraklOfferWriteRepositoryPort,
      offerDefaults: {},
      cardAttributes: empikOperatorProfile.cardAttributes,
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

  it('should let a failed card lookup through for a retry, never refusing the offer', async () => {
    const { creator, post, readCards } = setup();
    readCards.mockRejectedValueOnce(new MiraklApiException('down', 503));

    const error = await creator.createOffer(command()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MiraklApiException);
    expect(error).not.toBeInstanceOf(OfferCreateRejectedException);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])(
    'should let a %s from the offer import through for a retry, never refusing the offer',
    async (status) => {
      const { creator, post } = setup();
      post.mockRejectedValueOnce(new MiraklApiException('busy', status));

      const error = await creator.createOffer(command()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MiraklApiException);
      expect(error).not.toBeInstanceOf(OfferCreateRejectedException);
    }
  );

  it('should still create the offer when several cards share the EAN', async () => {
    const { creator, post } = setup([{ product_sku: 'A' }, { product_sku: 'B' }]);

    await expect(creator.createOffer(command())).resolves.toMatchObject({ status: 'validating' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('should let a rejected API key through, so the connection is flagged for re-auth', async () => {
    const { creator, post } = setup();
    post.mockRejectedValueOnce(new MiraklAuthenticationException('denied', 401));

    const error = await creator.createOffer(command()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MiraklAuthenticationException);
    expect(error).not.toBeInstanceOf(OfferCreateRejectedException);
  });
});

describe('MiraklOfferCreator without a card (#4278, part 2)', () => {
  const ATTRIBUTES: CategoryParameter[] = [
    {
      id: 'STR_GOLD',
      name: 'Struktura towarowa GOLD',
      type: 'string',
      required: true,
      restrictions: {},
      section: 'product',
    },
    {
      id: 'CATALOG_CODE',
      name: 'Numer katalogowy',
      type: 'string',
      required: true,
      restrictions: {},
      section: 'product',
    },
    {
      id: 'PELNY_TYTUL',
      name: 'Tytuł',
      type: 'string',
      required: true,
      restrictions: {},
      section: 'product',
    },
    {
      id: 'OPIS_PRODUKTU_PELNY',
      name: 'Opis',
      type: 'string',
      required: true,
      restrictions: {},
      section: 'product',
    },
    {
      id: 'ZDJECIE_OKLADKI_PRZOD_DUZY',
      name: 'Zdjęcie',
      type: 'string',
      required: true,
      restrictions: {},
      section: 'product',
    },
    {
      id: 'VAT_VALUE',
      name: 'Stawka VAT',
      type: 'dictionary',
      required: true,
      dictionary: [
        { id: '7', value: '23%' },
        { id: '3', value: '0%' },
      ],
      restrictions: {},
      section: 'product',
    },
    {
      id: '2100',
      name: 'Producent',
      type: 'string',
      required: true,
      restrictions: {},
      section: 'product',
    },
  ];

  function cardSetup(latest: { status: string } | null = null): {
    creator: MiraklOfferCreator;
    post: jest.Mock;
    recordPending: jest.Mock;
  } {
    const post = jest.fn();
    const recordPending = jest.fn().mockResolvedValue(undefined);
    const catalog = {
      readCards: jest.fn().mockResolvedValue(new Map()),
      readCardAttributes: jest.fn().mockResolvedValue(ATTRIBUTES),
    } as unknown as MiraklCatalog;
    const creator = new MiraklOfferCreator({
      connectionId: 'conn-1',
      adapterKey: 'empik.mirakl.v1',
      brand: 'Empik',
      httpClient: { post } as unknown as IMiraklHttpClient,
      catalog,
      writes: () =>
        ({
          recordPending,
          findLatest: jest.fn().mockResolvedValue(latest),
        }) as unknown as MiraklOfferWriteRepositoryPort,
      offerDefaults: { leadTimeToShip: 2, logisticClass: '1' },
      cardAttributes: empikOperatorProfile.cardAttributes,
    });
    return { creator, post, recordPending };
  }

  function cardCommand(overrides: Partial<CreateOfferCommand> = {}): CreateOfferCommand {
    return command({
      taxRate: '23',
      overrides: {
        categoryId: '21-20-1-6',
        title: 'Aparat',
        description: '<p>Opis</p>',
        imageUrls: ['https://img/1.jpg', 'https://img/2.jpg'],
      },
      parameters: [{ id: '2100', values: ['Canon'], section: 'product' }],
      ...overrides,
    });
  }

  it('should queue the card with the offer line and answer a draft waiting for the card', async () => {
    const { creator, post, recordPending } = cardSetup();

    const result = await creator.createOffer(cardCommand());

    expect(post).not.toHaveBeenCalled();
    expect(result).toEqual({ externalOfferId: SHOP_SKU, status: 'validating' });
    const [connectionId, kind, values] = recordPending.mock.calls[0] as [
      string,
      string,
      Array<{ offerSku: string; value: string }>,
    ];
    expect([connectionId, kind, values[0].offerSku]).toEqual(['conn-1', 'card', SHOP_SKU]);
    const request = JSON.parse(values[0].value) as MiraklCardRequest;
    expect(request.ean).toBe('9788380082113');
    expect(request.card).toEqual({
      STR_GOLD: '21-20-1-6',
      CATALOG_CODE: SHOP_SKU.slice(0, 26),
      EAN: '9788380082113',
      PELNY_TYTUL: 'Aparat',
      OPIS_PRODUKTU_PELNY: '<p>Opis</p>',
      ZDJECIE_OKLADKI_PRZOD_DUZY: 'https://img/1.jpg',
      DODATKOWE_ZDJECIA_1: 'https://img/2.jpg',
      VAT_VALUE: '7',
      '2100': 'Canon',
    });
    expect(request.offer).toMatchObject({
      shop_sku: SHOP_SKU,
      product_id: '9788380082113',
      price: '49.90',
    });
  });

  it('should refuse the card naming a required attribute left empty', async () => {
    const { creator, recordPending } = cardSetup();

    const error = await creator
      .createOffer(cardCommand({ parameters: [] }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OfferCreateRejectedException);
    expect((error as OfferCreateRejectedException).errors).toEqual([
      expect.objectContaining({ code: 'MIRAKL_CARD_ATTRIBUTE_REQUIRED', field: 'parameters.2100' }),
    ]);
    expect(recordPending).not.toHaveBeenCalled();
  });

  it('should refuse a card without a category', async () => {
    const { creator } = cardSetup();

    expect(
      await rejection(creator.createOffer(cardCommand({ overrides: { title: 'Aparat' } })))
    ).toEqual(['MIRAKL_CARD_CATEGORY_REQUIRED']);
  });

  it('should not queue a card already sent for the same offer', async () => {
    const { creator, recordPending } = cardSetup({ status: 'submitted' });

    const result = await creator.createOffer(cardCommand());

    expect(result.status).toBe('draft');
    expect(recordPending).not.toHaveBeenCalled();
  });
});
