/**
 * Subiekt Product Master Adapter — unit tests
 *
 * Driven against a mocked `fetch` (`FetchLike`) — no real HTTP. `ProductsEndpoints.cs`
 * exists on the Windows side and has been exercised live this session
 * (real 200 responses for create/update/read, real EAN-13 barcodes read back)
 * — this suite covers the TS-side mapping/error-classification logic that
 * live testing does not re-verify on every change.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { InMemoryIdentifierMappingAdapter } from '@openlinker/core/identifier-mapping/testing';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { FetchLike } from '@openlinker/shared/http';
import { SubiektProductMasterAdapter } from '../subiekt-product-master.adapter';
import { SubiektProductNotSupportedException } from '../../../domain/exceptions/subiekt-product-not-supported.exception';
import { SubiektBridgeTransportError } from '../../../domain/exceptions/subiekt-bridge-transport.exception';

/**
 * Build a transport-failure fetch mock carrying the SAME shape a real Node
 * `fetch` throw carries (`error.cause.code`) — #3373: the pre-fix tests here
 * put the code in `.message` instead, which `extractErrorCode` never reads,
 * so every such test silently exercised the 'indeterminate' branch regardless
 * of which code was used and never asserted `.retryability` at all.
 */
function transportFailure(code: string): FetchLike {
  return (() =>
    Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code } }))) as FetchLike;
}

/**
 * A `BridgeProduct` with every required field filled, so a test names only the
 * fields it is actually about.
 */
function bridgeProduct(
  symbol: string,
  nazwa: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    symbol,
    nazwa,
    cenaSprzedazyNetto: null,
    cenaSprzedazyBrutto: null,
    waluta: 'PLN',
    opis: null,
    kodKreskowy: null,
    jednostkaMiary: null,
    waga: null,
    stawkaVat: null,
    ...overrides,
  };
}

/**
 * A fetch mock that answers by ROUTE rather than returning one body for every
 * call. The adapter now reads three different bridge routes on one operation
 * (`/api/products`, `/api/models`, `/api/models/{id}`), so a single-body mock
 * would let a test pass while the adapter called the wrong one.
 */
function routed(
  symbolsBody: Record<string, unknown> = {},
  modelsBody: Record<string, unknown> = {},
  modelBody?: Record<string, unknown>,
  productBody?: Record<string, unknown>,
): FetchLike {
  return ((url: string) => {
    const path = String(url);
    if (/\/api\/models\/\d+/.test(path)) {
      return Promise.resolve(
        modelBody
          ? jsonResponse(200, envelope(modelBody))
          : jsonResponse(404, { success: false, data: null, error: 'no such model' }),
      );
    }
    if (path.includes('/api/models')) {
      return Promise.resolve(jsonResponse(200, envelope({ models: [], ...modelsBody })));
    }
    if (/\/api\/products\/.+/.test(path)) {
      return Promise.resolve(
        productBody
          ? jsonResponse(200, envelope(productBody))
          : jsonResponse(404, { success: false, data: null, error: 'no such towar' }),
      );
    }
    return Promise.resolve(jsonResponse(200, envelope({ symbols: [], ...symbolsBody })));
  }) as unknown as FetchLike;
}

function connection(): Connection {
  return new Connection(
    'conn-1',
    'subiekt-gt',
    'Subiekt GT (test)',
    'active',
    { bridgeBaseUrl: 'http://localhost:5056' },
    '',
    new Date(),
    new Date(),
    'subiekt.gt.v1',
    ['ProductMaster'],
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function envelope<T>(data: T): { success: true; data: T; error: null } {
  return { success: true, data, error: null };
}

describe('SubiektProductMasterAdapter', () => {
  let idMapping: InMemoryIdentifierMappingAdapter;

  beforeEach(() => {
    idMapping = new InMemoryIdentifierMappingAdapter();
  });

  function buildAdapter(fetchImpl: FetchLike): SubiektProductMasterAdapter {
    return new SubiektProductMasterAdapter('http://localhost:5056', idMapping, connection(), {
      token: 'olinvoicekey',
      fetchImpl,
    });
  }

  it('createProduct posts the bridge-native symbol/nazwa/price and mints an internal id', async () => {
    let capturedBody: unknown;
    const fetchImpl: FetchLike = ((_url: string, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return Promise.resolve(
        jsonResponse(
          200,
          envelope({
            symbol: 'WIDGET-1',
            nazwa: 'Widget',
            cenaSprzedazyNetto: null,
            cenaSprzedazyBrutto: 12.3,
            waluta: 'PLN',
            opis: null,
            kodKreskowy: null,
            jednostkaMiary: 'szt.',
            waga: null,
          }),
        ),
      );
    }) as FetchLike;

    const adapter = buildAdapter(fetchImpl);
    const product = await adapter.createProduct({
      name: 'Widget',
      sku: 'WIDGET-1',
      price: 12.3,
      currency: 'PLN',
    });

    expect(capturedBody).toMatchObject({ symbol: 'WIDGET-1', nazwa: 'Widget', cenaSprzedazyBrutto: 12.3 });
    expect(product.sku).toBe('WIDGET-1');
    expect(product.price).toBe(12.3);
    expect(product.id).toMatch(/^ol_product_/);
    // Re-fetching by external symbol must resolve to the SAME internal id.
    const externalIds = await idMapping.getExternalIds('Product', product.id);
    expect(externalIds).toContainEqual(
      expect.objectContaining({ externalId: 'WIDGET-1', connectionId: 'conn-1' }),
    );
  });

  it('getProduct throws MasterProductNotFoundError when the internal id has no mapping on this connection', async () => {
    const adapter = buildAdapter((() => Promise.resolve(jsonResponse(200, envelope({})))) as FetchLike);
    await expect(adapter.getProduct('ol_product_unknown')).rejects.toBeInstanceOf(
      MasterProductNotFoundError,
    );
  });

  it('getProduct throws MasterProductNotFoundError when the bridge rejects the symbol (gone at master)', async () => {
    await idMapping.createMapping('Product', 'GONE-1', 'conn-1', 'ol_product_1');
    const fetchImpl: FetchLike = (() =>
      Promise.resolve(
        jsonResponse(200, { success: false, data: null, error: 'No such towar' }),
      )) as FetchLike;

    const adapter = buildAdapter(fetchImpl);
    await expect(adapter.getProduct('ol_product_1')).rejects.toBeInstanceOf(MasterProductNotFoundError);
  });

  it('listExternalIds returns the bridge-reported symbols verbatim when no towar is modelled', async () => {
    const adapter = buildAdapter(routed({ symbols: ['A-1', 'B-2'] }, { models: [] }));
    await expect(adapter.listExternalIds({ limit: 50 })).resolves.toEqual(['A-1', 'B-2']);
  });

  it('listExternalIds substitutes the model key per MEMBER, keeping the page 1:1 with the towary read', async () => {
    const adapter = buildAdapter(
      routed(
        { symbols: ['WOBLACK100', 'DZFOREVER', 'WOBLACK50', 'WOBLACK70'] },
        { models: [{ modelId: 1, modelNazwa: 'Black Tiger', symbole: ['WOBLACK100', 'WOBLACK50', 'WOBLACK70'] }] },
      ),
    );

    // Four symbols in, four keys out - the model key three times over, in the
    // members' own positions. Collapsing them here would hand `readPagedIds` a
    // page shorter than the one it asked for, which that helper reads as the
    // end of the catalogue: the cycle would end at page one, clear its cursor
    // and log `cycle complete`, on every tick. It dedupes the collected ids
    // itself, AFTER counting what was read.
    await expect(adapter.listExternalIds({ limit: 50 })).resolves.toEqual([
      'model:1',
      'DZFOREVER',
      'model:1',
      'model:1',
    ]);
  });

  it('getProducts collapses the repeats listExternalIds deliberately keeps', async () => {
    // The other side of the same contract: this read has no cursor behind it,
    // so a model must be fetched and returned once, not once per member.
    await idMapping.createMapping('Product', 'model:1', 'conn-1', 'ol_product_model');
    const adapter = buildAdapter(
      routed(
        { symbols: ['WOBLACK100', 'WOBLACK50', 'WOBLACK70'] },
        { models: [{ modelId: 1, modelNazwa: 'Black Tiger', symbole: ['WOBLACK100', 'WOBLACK50', 'WOBLACK70'] }] },
        {
          modelId: 1,
          modelNazwa: 'Black Tiger woda toaletowa',
          pozycje: [bridgeProduct('WOBLACK100', 'Black Tiger woda toaletowa 100ml')],
        },
      ),
    );

    const products = await adapter.getProducts({ limit: 50 });
    expect(products).toHaveLength(1);
    expect(products[0]?.name).toBe('Black Tiger woda toaletowa');
  });

  it('listExternalIds degrades to plain symbols when the bridge serves no /api/models', async () => {
    // A bridge predating models 404s that route. That must read as "nothing is
    // modelled" - the pre-model behaviour - never as a failed enumeration.
    const fetchImpl: FetchLike = ((url: string) =>
      url.includes('/api/models')
        ? Promise.resolve(jsonResponse(404, { success: false, data: null, error: 'no such route' }))
        : Promise.resolve(jsonResponse(200, envelope({ symbols: ['A-1', 'B-2'] })))) as unknown as FetchLike;
    const adapter = buildAdapter(fetchImpl);
    await expect(adapter.listExternalIds({ limit: 50 })).resolves.toEqual(['A-1', 'B-2']);
  });

  it('getProductVariants returns one variant per model member, each with its own barcode and label', async () => {
    await idMapping.createMapping('Product', 'model:1', 'conn-1', 'ol_product_model');
    const adapter = buildAdapter(
      routed(
        {},
        {},
        {
          modelId: 1,
          modelNazwa: 'Black Tiger woda toaletowa',
          pozycje: [
            bridgeProduct('WOBLACK100', 'Black Tiger woda toaletowa 100ml', { kodKreskowy: '5900232204731', cenaSprzedazyBrutto: 551.02 }),
            bridgeProduct('WOBLACK50', 'Black Tiger woda toaletowa 50ml', { kodKreskowy: '5900232580286', cenaSprzedazyBrutto: 309.94 }),
          ],
        },
      ),
    );

    const variants = await adapter.getProductVariants('ol_product_model');
    expect(variants).toHaveLength(2);
    expect(variants.map((v) => v.sku)).toEqual(['WOBLACK100', 'WOBLACK50']);
    // The barcode is per towar, so it must be per variant - a shared one would
    // make two siblings the same product to a marketplace.
    expect(variants.map((v) => v.ean)).toEqual(['5900232204731', '5900232580286']);
    // The axis Subiekt does not carry, derived from the names.
    expect(variants.map((v) => v.attributes)).toEqual([{ Wariant: '100ml' }, { Wariant: '50ml' }]);
    expect(variants.map((v) => v.price)).toEqual([551.02, 309.94]);
  });

  it('getProduct on a model reports the model name and every member image', async () => {
    await idMapping.createMapping('Product', 'model:1', 'conn-1', 'ol_product_model');
    const adapter = buildAdapter(
      routed(
        {},
        {},
        {
          modelId: 1,
          modelNazwa: 'Black Tiger woda toaletowa',
          pozycje: [
            bridgeProduct('WOBLACK100', 'Black Tiger woda toaletowa 100ml', { zdjecia: ['http://b/gt-image/30'] }),
            bridgeProduct('WOBLACK50', 'Black Tiger woda toaletowa 50ml', { zdjecia: ['http://b/gt-image/31'] }),
          ],
        },
      ),
    );

    const product = await adapter.getProduct('ol_product_model');
    expect(product.name).toBe('Black Tiger woda toaletowa');
    expect(product.sku).toBe('MODEL-1');
    // A grouped listing wants the whole gallery, and the members are the photos.
    expect(product.images).toEqual(['http://b/gt-image/30', 'http://b/gt-image/31']);
  });

  it('getProduct on a towar that has since JOINED a model reports it deleted at the master', async () => {
    // The towar is a variant now, not a product. Saying so routes it into the
    // ordinary deletion path, which pauses its offers; serving it anyway would
    // leave two OpenLinker products claiming one towar.
    await idMapping.createMapping('Product', 'WOBLACK100', 'conn-1', 'ol_product_old');
    const adapter = buildAdapter(
      routed({}, {}, undefined, bridgeProduct('WOBLACK100', 'Black Tiger 100ml', { modelId: 1 })),
    );
    await expect(adapter.getProduct('ol_product_old')).rejects.toBeInstanceOf(MasterProductNotFoundError);
  });

  it('getProductVariants returns exactly one synthetic variant for a towar in no model', async () => {
    await idMapping.createMapping('Product', 'SKU-1', 'conn-1', 'ol_product_x');
    const adapter = buildAdapter(
      routed({}, {}, undefined, bridgeProduct('SKU-1', 'Thing', { cenaSprzedazyBrutto: 10 })),
    );
    const variants = await adapter.getProductVariants('ol_product_x');
    expect(variants).toHaveLength(1);
    expect(variants[0].productId).toBe('ol_product_x');
    expect(variants[0].sku).toBe('SKU-1');
    // No sibling to be distinguished from, so no axis is invented.
    expect(variants[0].attributes).toBeNull();
  });

  it('deleteProduct / assignCategories / upsertProductVariant throw SubiektProductNotSupportedException', async () => {
    const adapter = buildAdapter((() => Promise.resolve(jsonResponse(200, envelope({})))) as FetchLike);
    await expect(adapter.deleteProduct('ol_product_1')).rejects.toBeInstanceOf(
      SubiektProductNotSupportedException,
    );
    // `getProductCategories` no longer refuses - it reads the towar's group.
    // `assignCategories` still does, and deliberately: nothing in OpenLinker
    // needs to WRITE a Subiekt group in order to map categories.
    await expect(adapter.assignCategories('ol_product_1', ['x'])).rejects.toBeInstanceOf(
      SubiektProductNotSupportedException,
    );
    // #3356: previously a silent no-op returning the unchanged variant
    // dressed as success. Now honest, matching deleteProduct's posture.
    await expect(adapter.upsertProductVariant('ol_product_1')).rejects.toBeInstanceOf(
      SubiektProductNotSupportedException,
    );
  });

  it('classifies a connect-refused failure as a safe-to-retry SubiektBridgeTransportError (#3369/#3373)', async () => {
    const adapter = buildAdapter(transportFailure('ECONNREFUSED'));
    const rejection = adapter.listExternalIds();
    await expect(rejection).rejects.toBeInstanceOf(SubiektBridgeTransportError);
    await rejection.catch((error: SubiektBridgeTransportError) => {
      expect(error.retryability).toBe('safe');
    });
  });

  it('classifies an ambiguous transport failure as indeterminate (#3369/#3373)', async () => {
    const adapter = buildAdapter(transportFailure('ECONNRESET'));
    const rejection = adapter.listExternalIds();
    await expect(rejection).rejects.toBeInstanceOf(SubiektBridgeTransportError);
    await rejection.catch((error: SubiektBridgeTransportError) => {
      expect(error.retryability).toBe('indeterminate');
    });
  });

  describe('readProductTaxRate (#3357)', () => {
    it('does not read tax per variant — readsTaxRatePerVariant() is false', () => {
      const adapter = buildAdapter((() => Promise.resolve(jsonResponse(200, envelope({})))) as FetchLike);
      expect(adapter.readsTaxRatePerVariant()).toBe(false);
    });

    it('resolves a real rate as a percent-as-string code', async () => {
      await idMapping.createMapping('Product', 'SKU-VAT', 'conn-1', 'ol_product_vat');
      const fetchImpl: FetchLike = (() =>
        Promise.resolve(
          jsonResponse(
            200,
            envelope({
              symbol: 'SKU-VAT',
              nazwa: 'Kubek',
              cenaSprzedazyNetto: 20.32,
              cenaSprzedazyBrutto: 24.99,
              waluta: 'PLN',
              opis: null,
              kodKreskowy: null,
              jednostkaMiary: 'szt.',
              waga: null,
              stawkaVat: '23',
            }),
          ),
        )) as FetchLike;

      const adapter = buildAdapter(fetchImpl);
      await expect(adapter.readProductTaxRate({ productId: 'ol_product_vat' })).resolves.toEqual({
        kind: 'resolved',
        code: '23',
        countryIso2: 'PL',
      });
    });

    it('reports unknown/not-configured when the towar carries no VAT-rate assignment', async () => {
      await idMapping.createMapping('Product', 'SKU-NOVAT', 'conn-1', 'ol_product_novat');
      const fetchImpl: FetchLike = (() =>
        Promise.resolve(
          jsonResponse(
            200,
            envelope({
              symbol: 'SKU-NOVAT',
              nazwa: 'Kubek',
              cenaSprzedazyNetto: null,
              cenaSprzedazyBrutto: null,
              waluta: 'PLN',
              opis: null,
              kodKreskowy: null,
              jednostkaMiary: null,
              waga: null,
              stawkaVat: null,
            }),
          ),
        )) as FetchLike;

      const adapter = buildAdapter(fetchImpl);
      const resolution = await adapter.readProductTaxRate({ productId: 'ol_product_novat' });
      expect(resolution).toMatchObject({ kind: 'unknown', reason: 'not-configured' });
    });

    it('re-raises a transport failure rather than reporting unknown', async () => {
      await idMapping.createMapping('Product', 'SKU-DOWN', 'conn-1', 'ol_product_down');
      const adapter = buildAdapter(transportFailure('ECONNRESET'));
      const rejection = adapter.readProductTaxRate({ productId: 'ol_product_down' });
      await expect(rejection).rejects.toBeInstanceOf(SubiektBridgeTransportError);
      await rejection.catch((error: SubiektBridgeTransportError) => {
        expect(error.retryability).toBe('indeterminate');
      });
    });

    it('throws MasterProductNotFoundError when the internal id has no mapping on this connection', async () => {
      const adapter = buildAdapter((() => Promise.resolve(jsonResponse(200, envelope({})))) as FetchLike);
      await expect(
        adapter.readProductTaxRate({ productId: 'ol_product_unmapped' }),
      ).rejects.toBeInstanceOf(MasterProductNotFoundError);
    });

    // A model-keyed product used to GET `/api/products/model%3A5`, take the
    // bridge's 404 and raise MasterProductNotFoundError, which the sync
    // service swallows as a warn - so #3357 bought a model catalogue nothing
    // and every one of its order lines kept a NULL rate, silently.
    describe('a MODEL-keyed product', () => {
      const seedModel = async (): Promise<void> => {
        await idMapping.createMapping('Product', 'model:5', 'conn-1', 'ol_product_model');
      };

      it('reads /api/models/{id}, never /api/products/model%3A{id}', async () => {
        await seedModel();
        const urls: string[] = [];
        const adapter = buildAdapter(((url: string) => {
          urls.push(String(url));
          return Promise.resolve(
            jsonResponse(
              200,
              envelope({
                modelId: 5,
                modelNazwa: 'Black Tiger woda toaletowa',
                pozycje: [bridgeProduct('WOBLACK100', 'Black Tiger 100ml', { stawkaVat: '23' })],
              }),
            ),
          );
        }) as unknown as FetchLike);

        await adapter.readProductTaxRate({ productId: 'ol_product_model' });

        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain('/api/models/5');
        expect(urls[0]).not.toContain('/api/products');
      });

      it('resolves the rate its members agree on', async () => {
        await seedModel();
        const adapter = buildAdapter(
          routed({}, {}, {
            modelId: 5,
            modelNazwa: 'Black Tiger woda toaletowa',
            pozycje: [
              bridgeProduct('WOBLACK50', 'Black Tiger 50ml', { stawkaVat: '23' }),
              bridgeProduct('WOBLACK70', 'Black Tiger 70ml', { stawkaVat: '23' }),
              bridgeProduct('WOBLACK100', 'Black Tiger 100ml', { stawkaVat: '23' }),
            ],
          }),
        );

        await expect(adapter.readProductTaxRate({ productId: 'ol_product_model' })).resolves.toEqual({
          kind: 'resolved',
          code: '23',
          countryIso2: 'PL',
        });
      });

      // Never the first member's rate: readsTaxRatePerVariant() is false, so
      // one answer settles every sibling's order lines, and a silently-applied
      // wrong rate is a wrong figure on a fiscal document.
      it('reports unknown/ambiguous when members disagree', async () => {
        await seedModel();
        const adapter = buildAdapter(
          routed({}, {}, {
            modelId: 5,
            modelNazwa: 'Mieszany',
            pozycje: [
              bridgeProduct('A', 'A', { stawkaVat: '23' }),
              bridgeProduct('B', 'B', { stawkaVat: '8' }),
            ],
          }),
        );

        const resolution = await adapter.readProductTaxRate({ productId: 'ol_product_model' });

        expect(resolution).toMatchObject({ kind: 'unknown', reason: 'ambiguous' });
      });

      // An unassigned member is a distinct value, not a hole to fill from a
      // sibling - otherwise a half-configured model reads as fully configured.
      it('reports unknown/ambiguous when one member carries no assignment', async () => {
        await seedModel();
        const adapter = buildAdapter(
          routed({}, {}, {
            modelId: 5,
            modelNazwa: 'Czesciowo skonfigurowany',
            pozycje: [
              bridgeProduct('A', 'A', { stawkaVat: '23' }),
              bridgeProduct('B', 'B', { stawkaVat: null }),
            ],
          }),
        );

        const resolution = await adapter.readProductTaxRate({ productId: 'ol_product_model' });

        expect(resolution).toMatchObject({ kind: 'unknown', reason: 'ambiguous' });
      });

      it('reports unknown/not-configured when no member carries an assignment', async () => {
        await seedModel();
        const adapter = buildAdapter(
          routed({}, {}, {
            modelId: 5,
            modelNazwa: 'Bez stawki',
            pozycje: [bridgeProduct('A', 'A', { stawkaVat: null })],
          }),
        );

        const resolution = await adapter.readProductTaxRate({ productId: 'ol_product_model' });

        expect(resolution).toMatchObject({ kind: 'unknown', reason: 'not-configured' });
      });
    });
  });
  describe('categories (sl_GrupaTw)', () => {
    const productWithGroup = (
      grupaId: number | null,
      grupaNazwa: string | null,
    ): Record<string, unknown> => ({
      symbol: 'DZSO100',
      nazwa: 'Perfumy',
      cenaSprzedazyNetto: null,
      cenaSprzedazyBrutto: 10,
      waluta: 'PLN',
      opis: null,
      kodKreskowy: null,
      jednostkaMiary: 'szt.',
      waga: null,
      grupaId,
      grupaNazwa,
    });

    const seedProduct = (): void => {
      idMapping.seed({
        entityType: 'Product',
        externalId: 'DZSO100',
        connectionId: 'conn-1',
        internalId: 'ol_product_1',
      });
    };

    it('getCategories returns the flat group list with no parentId and no depth', async () => {
      // sl_GrupaTw has no parent column, so a hierarchy here would be one this
      // adapter invented and an operator would be mapping against a shape that
      // exists nowhere but here.
      const adapter = buildAdapter(
        (() =>
          Promise.resolve(
            jsonResponse(
              200,
              envelope({
                categories: [
                  { id: 3, nazwa: 'Perfumy' },
                  { id: 6, nazwa: 'Wody' },
                ],
              }),
            ),
          )) as FetchLike,
      );

      const categories = await adapter.getCategories();

      expect(categories).toEqual([
        { id: '3', name: 'Perfumy' },
        { id: '6', name: 'Wody' },
      ]);
      expect(categories[0]).not.toHaveProperty('parentId');
      expect(categories[0]).not.toHaveProperty('depth');
    });

    it('getCategories asks the bridge for the group list, not for a product', async () => {
      let requestedUrl = '';
      const adapter = buildAdapter(((url: string) => {
        requestedUrl = url;
        return Promise.resolve(jsonResponse(200, envelope({ categories: [] })));
      }) as FetchLike);

      await adapter.getCategories();

      expect(requestedUrl).toContain('/api/products/categories');
    });

    it('getProductCategories returns the towar single group', async () => {
      seedProduct();
      const adapter = buildAdapter(
        (() =>
          Promise.resolve(jsonResponse(200, envelope(productWithGroup(3, 'Perfumy'))))) as FetchLike,
      );

      // Subiekt gives a towar exactly ONE group, so this can never be more
      // than one entry - the array is the port shape, not a claim otherwise.
      await expect(adapter.getProductCategories('ol_product_1')).resolves.toEqual([
        { id: '3', name: 'Perfumy' },
      ]);
    });

    it('returns an empty array for a towar with no group', async () => {
      seedProduct();
      const adapter = buildAdapter(
        (() =>
          Promise.resolve(jsonResponse(200, envelope(productWithGroup(null, null))))) as FetchLike,
      );

      // An ungrouped towar is entirely ordinary. Throwing here - which is what
      // this method used to do unconditionally - made a normal catalogue read
      // fail.
      await expect(adapter.getProductCategories('ol_product_1')).resolves.toEqual([]);
    });

    it('falls back to the id as the label when the group carries no name', async () => {
      seedProduct();
      const adapter = buildAdapter(
        (() => Promise.resolve(jsonResponse(200, envelope(productWithGroup(3, null))))) as FetchLike,
      );

      // The id is the mappable fact; a missing label is a display problem, not
      // an absent group.
      await expect(adapter.getProductCategories('ol_product_1')).resolves.toEqual([
        { id: '3', name: '3' },
      ]);
    });

    it('falls back to the id when the group name is the EMPTY STRING, not only when it is null', async () => {
      seedProduct();
      const adapter = buildAdapter(
        (() => Promise.resolve(jsonResponse(200, envelope(productWithGroup(3, ''))))) as FetchLike,
      );

      // The bridge `.Trim()`s the name, so a whitespace-only `grt_Nazwa`
      // arrives as `''` rather than null - the case a null-only test does not
      // reach, and the one that would render a category labelled with nothing.
      await expect(adapter.getProductCategories('ol_product_1')).resolves.toEqual([
        { id: '3', name: '3' },
      ]);
    });

    it('translates a bridge "no such towar" into a master-side absence', async () => {
      seedProduct();
      const adapter = buildAdapter(
        (() =>
          Promise.resolve(
            jsonResponse(404, { success: false, data: null, error: 'No product with symbol DZSO100.' }),
          )) as FetchLike,
      );

      // The mapping exists, so this is Subiekt reporting the towar gone - the
      // same signal `getProduct` translates, rather than a transport failure.
      await expect(adapter.getProductCategories('ol_product_1')).rejects.toBeInstanceOf(
        MasterProductNotFoundError,
      );
    });

    it('reports an unmapped product as a master-side absence, not as an empty category list', async () => {
      const adapter = buildAdapter(
        (() => Promise.resolve(jsonResponse(200, envelope(productWithGroup(3, 'Perfumy'))))) as FetchLike,
      );

      await expect(adapter.getProductCategories('ol_product_unknown')).rejects.toBeInstanceOf(
        MasterProductNotFoundError,
      );
    });

    // Before this branch the method GET `/api/products/model%3A5`, took the
    // bridge's 404 and reported master-side DELETION rather than "no
    // category" - and ProductPublishBuilderService catches that and publishes
    // the product with no category at all, so the defect showed up as a shop
    // listing in no category and as an error nowhere.
    describe('a MODEL-keyed product', () => {
      const seedModel = async (): Promise<void> => {
        await idMapping.createMapping('Product', 'model:5', 'conn-1', 'ol_product_model');
      };

      it('reads /api/models/{id}, never /api/products/model%3A{id}', async () => {
        await seedModel();
        const urls: string[] = [];
        const adapter = buildAdapter(((url: string) => {
          urls.push(String(url));
          return Promise.resolve(
            jsonResponse(
              200,
              envelope({
                modelId: 5,
                modelNazwa: 'Black Tiger woda toaletowa',
                pozycje: [bridgeProduct('WOBLACK100', 'Black Tiger 100ml', { grupaId: 3, grupaNazwa: 'Perfumy' })],
              }),
            ),
          );
        }) as unknown as FetchLike);

        await adapter.getProductCategories('ol_product_model');

        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain('/api/models/5');
        expect(urls[0]).not.toContain('/api/products');
      });

      it('answers with the representative member group', async () => {
        await seedModel();
        const adapter = buildAdapter(
          routed({}, {}, {
            modelId: 5,
            modelNazwa: 'Black Tiger woda toaletowa',
            pozycje: [
              bridgeProduct('WOBLACK100', 'Black Tiger 100ml', { grupaId: 3, grupaNazwa: 'Perfumy' }),
              bridgeProduct('WOBLACK50', 'Black Tiger 50ml', { grupaId: 6, grupaNazwa: 'Wody' }),
            ],
          }),
        );

        await expect(adapter.getProductCategories('ol_product_model')).resolves.toEqual([
          { id: '3', name: 'Perfumy' },
        ]);
      });

      it('answers with an empty list for a model carrying no members', async () => {
        await seedModel();
        const adapter = buildAdapter(
          routed({}, {}, { modelId: 5, modelNazwa: 'Pusty', pozycje: [] }),
        );

        await expect(adapter.getProductCategories('ol_product_model')).resolves.toEqual([]);
      });
    });
  });
});
