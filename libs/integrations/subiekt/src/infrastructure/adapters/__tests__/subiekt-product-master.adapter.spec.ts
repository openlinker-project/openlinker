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

  it('listExternalIds returns the bridge-reported symbols verbatim', async () => {
    const fetchImpl: FetchLike = (() =>
      Promise.resolve(jsonResponse(200, envelope({ symbols: ['A-1', 'B-2'] })))) as FetchLike;
    const adapter = buildAdapter(fetchImpl);
    await expect(adapter.listExternalIds({ limit: 50 })).resolves.toEqual(['A-1', 'B-2']);
  });

  it('getProductVariants returns exactly one synthetic variant per product', async () => {
    await idMapping.createMapping('Product', 'SKU-1', 'conn-1', 'ol_product_x');
    const fetchImpl: FetchLike = (() =>
      Promise.resolve(
        jsonResponse(
          200,
          envelope({
            symbol: 'SKU-1',
            nazwa: 'Thing',
            cenaSprzedazyNetto: null,
            cenaSprzedazyBrutto: 10,
            waluta: 'PLN',
            opis: null,
            kodKreskowy: null,
            jednostkaMiary: null,
            waga: null,
          }),
        ),
      )) as FetchLike;

    const adapter = buildAdapter(fetchImpl);
    const variants = await adapter.getProductVariants('ol_product_x');
    expect(variants).toHaveLength(1);
    expect(variants[0].productId).toBe('ol_product_x');
    expect(variants[0].sku).toBe('SKU-1');
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
  });
});
