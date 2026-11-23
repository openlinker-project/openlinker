/**
 * BundleReader on the Subiekt GT product master
 *
 * Driven against a route-keyed `fetch` mock. The komplet wire shape is the one
 * `GET /api/products/{symbol}/komplet` answers (see `BridgeKomplet`).
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { InMemoryIdentifierMappingAdapter } from '@openlinker/core/identifier-mapping/testing';
import { isBundleReader, MasterProductNotFoundError } from '@openlinker/core/products';
import type { FetchLike } from '@openlinker/shared/http';
import { SubiektProductMasterAdapter } from '../subiekt-product-master.adapter';
import { SubiektKompletUnreadableException } from '../../../domain/exceptions/subiekt-komplet-unreadable.exception';
import { SubiektBridgeTransportError } from '../../../domain/exceptions/subiekt-bridge-transport.exception';

function jsonResponse(status: number, body: unknown): Response {
  return { status, json: () => Promise.resolve(body) } as unknown as Response;
}

function ok(data: unknown): Response {
  return jsonResponse(200, { success: true, data, error: null });
}

function notFound(reason: string): Response {
  return jsonResponse(404, {
    success: false,
    data: null,
    error: { code: 'not_found', reason, correlationId: null },
  });
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
    ['ProductMaster']
  );
}

const KIT = {
  symbol: 'ZESO20',
  rodzaj: 8,
  jestKompletem: true,
  skladniki: [
    { symbol: 'PESO20', ilosc: 1, usuniety: false },
    { symbol: 'POYAR01', ilosc: 2, usuniety: false },
  ],
};

describe('SubiektProductMasterAdapter BundleReader', () => {
  let idMapping: InMemoryIdentifierMappingAdapter;
  const requested: string[] = [];

  beforeEach(() => {
    idMapping = new InMemoryIdentifierMappingAdapter();
    requested.length = 0;
  });

  function build(
    komplet: (path: string) => Response,
    models: Array<{ modelId: number; modelNazwa: string; symbole: string[] }> = []
  ): SubiektProductMasterAdapter {
    const fetchImpl = ((url: string) => {
      const path = String(url).replace('http://localhost:5056', '');
      requested.push(path);
      if (path.startsWith('/api/models')) {
        return Promise.resolve(ok({ models }));
      }
      return Promise.resolve(komplet(path));
    }) as unknown as FetchLike;
    return new SubiektProductMasterAdapter('http://localhost:5056', idMapping, connection(), {
      token: 'olinvoicekey',
      fetchImpl,
    });
  }

  it('should be recognised by the isBundleReader guard', () => {
    expect(isBundleReader(build(() => ok(KIT)))).toBe(true);
  });

  it('should return the components of a komplet keyed like the canonical variant mapping', async () => {
    const adapter = build(() => ok(KIT));

    await expect(adapter.readBundleComposition('ZESO20')).resolves.toEqual({
      components: [
        { externalProductId: 'PESO20', externalVariantId: 'PESO20::variant', quantity: 1 },
        { externalProductId: 'POYAR01', externalVariantId: 'POYAR01::variant', quantity: 2 },
      ],
    });
    expect(requested[0]).toBe('/api/products/ZESO20/komplet');
  });

  it('should key a component by the same external id its variant mapping already uses', async () => {
    // A legacy install carries the bare symbol, a newer one the canonical key.
    const legacy = await idMapping.getOrCreateInternalId('ProductVariant', 'PESO20', 'conn-1');
    const canonical = await idMapping.getOrCreateInternalId(
      'ProductVariant',
      'POYAR01::variant',
      'conn-1'
    );
    const adapter = build(() => ok(KIT));

    const composition = await adapter.readBundleComposition('ZESO20');

    expect(composition?.components.map((c) => c.externalVariantId)).toEqual([
      'PESO20',
      'POYAR01::variant',
    ]);
    for (const [index, expected] of [legacy, canonical].entries()) {
      await expect(
        idMapping.getInternalId(
          'ProductVariant',
          composition?.components[index].externalVariantId ?? '',
          'conn-1'
        )
      ).resolves.toBe(expected);
    }
  });

  it('should use the model key as the component product id when the component sits in a model', async () => {
    const adapter = build(() => ok(KIT), [
      { modelId: 7, modelNazwa: 'Peso', symbole: ['PESO20', 'PESO30'] },
    ]);

    const composition = await adapter.readBundleComposition('ZESO20');

    expect(composition?.components[0]).toEqual({
      externalProductId: 'model:7',
      externalVariantId: 'PESO20::variant',
      quantity: 1,
    });
  });

  it('should return null for a towar that is not a komplet', async () => {
    const adapter = build(() =>
      ok({ symbol: 'PESO20', rodzaj: 1, jestKompletem: false, skladniki: [] })
    );

    await expect(adapter.readBundleComposition('PESO20')).resolves.toBeNull();
  });

  it('should return null for a model key without asking the bridge', async () => {
    const adapter = build(() => ok(KIT));

    await expect(adapter.readBundleComposition('model:7')).resolves.toBeNull();
    expect(requested).toEqual([]);
  });

  it('should report an unknown symbol as a master-side absence', async () => {
    const adapter = build(() => notFound('No product with symbol NOPE.'));

    await expect(adapter.readBundleComposition('NOPE')).rejects.toBeInstanceOf(
      MasterProductNotFoundError
    );
  });

  it('should refuse a komplet with a deleted component rather than shorten it', async () => {
    const adapter = build(() =>
      ok({
        ...KIT,
        skladniki: [KIT.skladniki[0], { symbol: 'POYAR01', ilosc: 1, usuniety: true }],
      })
    );

    await expect(adapter.readBundleComposition('ZESO20')).rejects.toBeInstanceOf(
      SubiektKompletUnreadableException
    );
  });

  it('should refuse a fractional component quantity', async () => {
    const adapter = build(() =>
      ok({ ...KIT, skladniki: [{ symbol: 'PESO20', ilosc: 1.5, usuniety: false }] })
    );

    await expect(adapter.readBundleComposition('ZESO20')).rejects.toBeInstanceOf(
      SubiektKompletUnreadableException
    );
  });

  it('should propagate a transport failure instead of answering null', async () => {
    const fetchImpl = (() =>
      Promise.reject(
        Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
      )) as unknown as FetchLike;
    const adapter = new SubiektProductMasterAdapter('http://localhost:5056', idMapping, connection(), {
      fetchImpl,
    });

    await expect(adapter.readBundleComposition('ZESO20')).rejects.toBeInstanceOf(
      SubiektBridgeTransportError
    );
  });

  it('should read the komplet route once when asked twice', async () => {
    const adapter = build(() => ok(KIT));

    await adapter.readBundleComposition('ZESO20');
    await adapter.readBundleComposition('ZESO20');

    expect(requested.filter((p) => p.endsWith('/komplet'))).toHaveLength(1);
  });
});
