/**
 * Subiekt Product Master Adapter — unit tests
 *
 * Driven against a mocked `fetch` (`FetchLike`) — no real HTTP, no real
 * bridge. There is no `ProductsEndpoints.cs` on the Windows side yet (see the
 * adapter's own header docblock), so this suite is the only verification this
 * code has received.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { InMemoryIdentifierMappingAdapter } from '@openlinker/core/identifier-mapping/testing';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { FetchLike } from '@openlinker/shared/http';
import { SubiektProductMasterAdapter } from '../subiekt-product-master.adapter';
import { SubiektProductNotSupportedException } from '../../../domain/exceptions/subiekt-product-not-supported.exception';
import { SubiektBridgeUnreachableError } from '../../../bridge/subiekt-bridge.errors';

function connection(): Connection {
  return new Connection(
    'conn-1',
    'subiekt',
    'Subiekt GT (test)',
    'active',
    { bridgeBaseUrl: 'http://localhost:5056' },
    '',
    new Date(),
    new Date(),
    'subiekt.invoicing.v1',
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

  it('deleteProduct / getProductCategories / assignCategories throw SubiektProductNotSupportedException', async () => {
    const adapter = buildAdapter((() => Promise.resolve(jsonResponse(200, envelope({})))) as FetchLike);
    await expect(adapter.deleteProduct('ol_product_1')).rejects.toBeInstanceOf(
      SubiektProductNotSupportedException,
    );
    await expect(adapter.getProductCategories('ol_product_1')).rejects.toBeInstanceOf(
      SubiektProductNotSupportedException,
    );
    await expect(adapter.assignCategories('ol_product_1', ['x'])).rejects.toBeInstanceOf(
      SubiektProductNotSupportedException,
    );
  });

  it('translates a network failure into SubiektBridgeUnreachableError', async () => {
    const fetchImpl: FetchLike = (() => {
      return Promise.reject(new Error('ECONNREFUSED'));
    }) as FetchLike;
    const adapter = buildAdapter(fetchImpl);
    await expect(adapter.listExternalIds()).rejects.toBeInstanceOf(SubiektBridgeUnreachableError);
  });
});
