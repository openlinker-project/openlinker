/**
 * Http Transport Factory Unit Tests
 *
 * @module libs/shared/src/http
 */
import { HttpTransportFactory } from '../http-transport-factory';
import {
  createRateLimiterRegistry,
  RateLimitAbortedError,
  runWithPriority,
} from '../../rate-limit';
import type { RateLimiterPort, RateLimiterRegistry } from '../../rate-limit';

/**
 * Poll until `predicate` holds, so assertions about the limiter synchronise on
 * its own observable state instead of a fixed sleep. Throws on timeout rather
 * than letting the test fall through to an assertion that would then fail for
 * a misleading reason.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe('HttpTransportFactory', () => {
  let registry: RateLimiterRegistry;

  beforeEach(() => {
    registry = createRateLimiterRegistry();
  });

  it('returns a stable FetchLike reference per connection, not a new closure per call', () => {
    const factory = new HttpTransportFactory({ registry });
    const connection = { id: 'conn-1' };

    const first = factory.forConnection(connection);
    const second = factory.forConnection(connection);

    expect(first).toBe(second);
  });

  it('delegates to the injected fetchImpl and releases the slot on success', async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 1 } } };
    const boundFetch = factory.forConnection(connection);

    const result = await boundFetch('https://example.com');

    expect(fetchImpl).toHaveBeenCalledWith('https://example.com', undefined);
    expect(result).toBe(response);
    expect(registry.getStatus('conn-1')?.inFlight).toBe(0);
  });

  it('resolves globalThis.fetch per call when no fetchImpl is injected', async () => {
    const factory = new HttpTransportFactory({ registry });
    const boundFetch = factory.forConnection({ id: 'conn-1' });

    // Swapped AFTER construction — the factory is a boot-time singleton, so a
    // reference captured in the constructor would escape to the real network.
    const originalFetch = globalThis.fetch;
    const response = new Response(null, { status: 200 });
    const stub = jest.fn().mockResolvedValue(response);
    globalThis.fetch = stub as unknown as typeof fetch;
    try {
      await expect(boundFetch('https://example.com')).resolves.toBe(response);
      expect(stub).toHaveBeenCalledWith('https://example.com', undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('releases the slot even when the underlying fetch throws', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 1 } } };
    const boundFetch = factory.forConnection(connection);

    await expect(boundFetch('https://example.com')).rejects.toThrow('network down');
    expect(registry.getStatus('conn-1')?.inFlight).toBe(0);
  });

  it('passes a 429 response through unmodified while feeding Retry-After into the limiter', async () => {
    const response = new Response(null, {
      status: 429,
      headers: { 'Retry-After': '5' },
    });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1', config: { rateLimit: { requestsPerMinute: 60 } } };
    const boundFetch = factory.forConnection(connection);

    const result = await boundFetch('https://example.com');

    expect(result).toBe(response);
    expect(result.status).toBe(429);

    // A second acquire on the same connection is now gated by the 5s
    // Retry-After push, not just the ordinary 1s (60/min) spacing.
    const limiter = registry.get('conn-1', { requestsPerMinute: 60 });
    let resolved = false;
    void limiter.acquire({ requestsPerMinute: 60 }).then((release) => {
      resolved = true;
      release();
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
  });

  it('treats an absent config.rateLimit as unlimited', async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1' };
    const boundFetch = factory.forConnection(connection);

    await Promise.all([boundFetch('a'), boundFetch('b'), boundFetch('c')]);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("falls back to the caller-supplied defaultRateLimit when config.rateLimit is absent (AdapterMetadata's manifest value)", async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1' };
    const boundFetch = factory.forConnection(connection, { maxConcurrent: 1 });

    await boundFetch('https://example.com');

    expect(registry.getStatus('conn-1')?.maxConcurrent).toBe(1);
  });

  it("an explicit config.rateLimit always wins over the caller-supplied defaultRateLimit", async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 5 } } };
    const boundFetch = factory.forConnection(connection, { maxConcurrent: 1 });

    await boundFetch('https://example.com');

    expect(registry.getStatus('conn-1')?.maxConcurrent).toBe(5);
  });

  it('does not let a defaultRateLimit-less for() call clobber a previously-established default for the same connection id', async () => {
    // Regression: the process-wide singleton is keyed only by connection.id,
    // so two independent call sites resolving the same connection must not
    // fight over `defaultRateLimit` — the second caller omitting it (e.g. a
    // connection tester that only passes `connection`) must not wipe out the
    // manifest default a prior caller already established.
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1' };
    factory.forConnection(connection, { maxConcurrent: 1 });
    const boundFetch = factory.forConnection(connection);

    await boundFetch('https://example.com');

    expect(registry.getStatus('conn-1')?.maxConcurrent).toBe(1);
  });

  it('divides the configured cap when constructed with an explicit replicas count', async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl, replicas: 4 });

    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 4 } } };
    const boundFetch = factory.forConnection(connection);

    await boundFetch('https://example.com');

    // 4 replicas dividing a cap of 4 leaves each replica a cap of 1. The DI
    // wiring in `libs/plugin-sdk/src/rate-limit.module.ts` no longer passes
    // `replicas` (#2015 — the registry is Redis-shared already), but the
    // option itself still works for a caller that constructs its own
    // `HttpTransportFactory` directly.
    expect(registry.getStatus('conn-1')?.maxConcurrent).toBe(1);
  });

  it('re-reads config.rateLimit on every for() call, even through a cached FetchLike (no stale-connection cache)', async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const stale = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 5 } } };
    const boundFetch = factory.forConnection(stale);

    // Operator edits config.rateLimit — caller re-resolves the connection and
    // calls for() again with the SAME id but a fresh object. The cached
    // FetchLike reference must still pick up the new policy.
    const fresh = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 1 } } };
    const sameFetch = factory.forConnection(fresh);
    expect(sameFetch).toBe(boundFetch);

    await boundFetch('https://example.com');

    expect(registry.getStatus('conn-1')?.maxConcurrent).toBe(1);
  });

  it('shares one bucket across every host a connection talks to (#1968 review)', async () => {
    // A plugin with several physical hosts per connection (Allegro serves REST
    // from api.allegro.pl and image uploads from upload.allegro.pl) resolves
    // ONE transport and hands it to every client — the bucket is keyed on the
    // connection id alone. See ADR-038 § "The cap is per connection" for why
    // hostname is not a quota axis.
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 1 } } };
    expect(factory.forConnection(connection)).toBe(factory.forConnection(connection));

    const boundFetch = factory.forConnection(connection);

    // Saturate the connection's single slot from outside the transport...
    const release = await registry
      .get('conn-1', { maxConcurrent: 1 })
      .acquire({ maxConcurrent: 1 }, 'background');

    // ...and traffic to the *other* host must queue rather than sail past on a
    // bucket of its own. Synchronise on the limiter's own observable state
    // rather than a fixed sleep: a timing-based assertion would pass for the
    // wrong reason on a loaded runner (nothing scheduled yet reads the same as
    // correctly blocked).
    const inFlight = boundFetch('https://upload.example.com');
    await waitFor(() => registry.getStatus('conn-1')?.queued === 1);

    expect(fetchImpl).not.toHaveBeenCalled();

    release();
    await inFlight;
    expect(fetchImpl).toHaveBeenCalledWith('https://upload.example.com', undefined);
  });

  it('forwards the active AsyncLocalStorage cancellation signal into acquire()', async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl });
    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 1 } } };
    const boundFetch = factory.forConnection(connection);

    // Hold the one available slot so a subsequent acquire() queues on the signal.
    const release = await registry
      .get('conn-1', { maxConcurrent: 1 })
      .acquire({ maxConcurrent: 1 }, 'background');

    const controller = new AbortController();
    const queuedCall = runWithPriority({ priority: 'background', signal: controller.signal }, () =>
      boundFetch('https://example.com')
    );

    let rejected = false;
    queuedCall.catch(() => {
      rejected = true;
    });

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(rejected).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    release();
  });

  describe("the request's own signal while queued", () => {
    // A plugin arms its request timeout before calling the transport. On a busy
    // bucket that timer can fire while the request is still queued; the wait
    // must end there, never claim the slot, and never call the network.
    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 1 } } };

    it('should reject with RateLimitAbortedError and never call fetch when the request is aborted while queued', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const boundFetch = factory.forConnection(connection);
      const holder = await registry
        .get('conn-1', { maxConcurrent: 1 })
        .acquire({ maxConcurrent: 1 }, 'background');

      const controller = new AbortController();
      const queued = boundFetch('https://example.com', { signal: controller.signal });
      await waitFor(() => registry.getStatus('conn-1')?.queued === 1);
      controller.abort();

      await expect(queued).rejects.toBeInstanceOf(RateLimitAbortedError);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(registry.getStatus('conn-1')).toEqual(
        expect.objectContaining({ inFlight: 1, queued: 0 })
      );

      holder();
      expect(registry.getStatus('conn-1')?.inFlight).toBe(0);
    });

    it('should not claim a slot for a request whose signal is already aborted', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const boundFetch = factory.forConnection(connection);
      const controller = new AbortController();
      controller.abort();

      await expect(
        boundFetch('https://example.com', { signal: controller.signal })
      ).rejects.toBeInstanceOf(RateLimitAbortedError);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(registry.getStatus('conn-1')?.inFlight ?? 0).toBe(0);
    });

    it('should release the granted slot without calling fetch when the request aborts as the slot is granted', async () => {
      const controller = new AbortController();
      const release = jest.fn();
      const limiter: RateLimiterPort = {
        acquire: jest.fn(() => {
          // The grant and the abort land in the same tick.
          controller.abort();
          return Promise.resolve(release);
        }),
        noteRetryAfter: jest.fn(),
        getStatus: jest.fn(),
      };
      const stubRegistry: RateLimiterRegistry = {
        get: () => limiter,
        getStatus: () => null,
        evict: jest.fn(),
        clear: jest.fn(),
      };
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry: stubRegistry, fetchImpl });

      await expect(
        factory.forConnection(connection)('https://example.com', { signal: controller.signal })
      ).rejects.toBeInstanceOf(RateLimitAbortedError);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('should honour both the context signal and the request signal, and detach from both once the wait settles', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const boundFetch = factory.forConnection(connection);
      const contextController = new AbortController();
      const requestController = new AbortController();
      const contextRemove = jest.spyOn(contextController.signal, 'removeEventListener');
      const requestRemove = jest.spyOn(requestController.signal, 'removeEventListener');

      await runWithPriority({ priority: 'background', signal: contextController.signal }, () =>
        boundFetch('https://example.com', { signal: requestController.signal })
      );

      expect(fetchImpl).toHaveBeenCalledWith('https://example.com', {
        signal: requestController.signal,
      });
      // The context signal is typically the runner's, alive for the whole
      // process; a listener left on it per request would accumulate for ever.
      expect(contextRemove).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(requestRemove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('should still end the wait on the context signal when the request carries its own', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const boundFetch = factory.forConnection(connection);
      const holder = await registry
        .get('conn-1', { maxConcurrent: 1 })
        .acquire({ maxConcurrent: 1 }, 'background');
      const contextController = new AbortController();

      const queued = runWithPriority(
        { priority: 'background', signal: contextController.signal },
        () => boundFetch('https://example.com', { signal: new AbortController().signal })
      );
      await waitFor(() => registry.getStatus('conn-1')?.queued === 1);
      contextController.abort();

      await expect(queued).rejects.toBeInstanceOf(RateLimitAbortedError);
      expect(fetchImpl).not.toHaveBeenCalled();
      holder();
    });
  });

  it('evict() drops the cached FetchLike, connection ref, and underlying limiter for a connection', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const factory = new HttpTransportFactory({ registry, fetchImpl });
    const connection = { id: 'conn-1', config: { rateLimit: { requestsPerMinute: 60 } } };

    const boundFetch = factory.forConnection(connection);
    await boundFetch('https://example.com');
    expect(registry.getStatus('conn-1')).not.toBeNull();

    factory.evict('conn-1');

    expect(registry.getStatus('conn-1')).toBeNull();
    expect(factory.forConnection(connection)).not.toBe(boundFetch);
  });

  it('evict() on a connection id never resolved via forConnection() is a safe no-op', () => {
    const factory = new HttpTransportFactory({ registry });

    expect(() => factory.evict('never-seen')).not.toThrow();
  });
  describe('shared bucket (options.bucketKey, ADR-038 § Amendment)', () => {
    const SHOP_CEILING = { requestsPerMinute: 300, maxConcurrent: 4 };

    it('should draw from the connection-id bucket when no bucketKey is given', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const getSpy = jest.spyOn(registry, 'get');

      await factory.forConnection({ id: 'conn-1' }, SHOP_CEILING)('https://example.com');

      expect(getSpy).toHaveBeenCalledWith('conn-1', SHOP_CEILING);
    });

    it('should pace two connections against ONE registry bucket when they name the same bucketKey', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const getSpy = jest.spyOn(registry, 'get');
      const options = { bucketKey: 'shoper:host:sklep1.shoparena.pl' };

      await factory.forConnection({ id: 'conn-1' }, SHOP_CEILING, options)('a');
      await factory.forConnection({ id: 'conn-2' }, SHOP_CEILING, options)('b');

      expect(getSpy.mock.calls.map(([key]) => key)).toEqual([
        'shoper:host:sklep1.shoparena.pl',
        'shoper:host:sklep1.shoparena.pl',
      ]);
      expect(registry.getStatus('conn-1')).toBeNull();
      expect(registry.getStatus('conn-2')).toBeNull();
    });

    it('should queue a second connection behind the first when they share a bucket', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const options = { bucketKey: 'shop-a' };
      const ceiling = { maxConcurrent: 1 };

      const release = await registry.get('shop-a', ceiling).acquire(ceiling, 'background');
      const sibling = factory.forConnection({ id: 'conn-2' }, ceiling, options)('https://shop-a');
      await waitFor(() => registry.getStatus('shop-a')?.queued === 1);

      expect(fetchImpl).not.toHaveBeenCalled();

      release();
      await sibling;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('should use separate buckets when connections name different bucketKeys', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const getSpy = jest.spyOn(registry, 'get');

      await factory.forConnection({ id: 'conn-1' }, SHOP_CEILING, { bucketKey: 'shop-a' })('a');
      await factory.forConnection({ id: 'conn-2' }, SHOP_CEILING, { bucketKey: 'shop-b' })('b');

      expect(getSpy.mock.calls.map(([key]) => key)).toEqual(['shop-a', 'shop-b']);
    });

    it('should not hand back a fetch bound to a different bucket when the same connection asks with and without a bucketKey', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const getSpy = jest.spyOn(registry, 'get');
      const connection = { id: 'conn-1' };

      const own = factory.forConnection(connection, SHOP_CEILING);
      const shared = factory.forConnection(connection, SHOP_CEILING, { bucketKey: 'shop-a' });
      const otherShared = factory.forConnection(connection, SHOP_CEILING, { bucketKey: 'shop-b' });

      expect(shared).not.toBe(own);
      expect(otherShared).not.toBe(shared);
      expect(factory.forConnection(connection, SHOP_CEILING, { bucketKey: 'shop-a' })).toBe(shared);
      expect(factory.forConnection(connection, SHOP_CEILING)).toBe(own);

      await own('x');
      await shared('y');
      await otherShared('z');
      expect(getSpy.mock.calls.map(([key]) => key)).toEqual(['conn-1', 'shop-a', 'shop-b']);
    });

    it('should treat an empty bucketKey as no bucket when one is passed by mistake', () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const connection = { id: 'conn-1' };

      expect(factory.forConnection(connection, undefined, { bucketKey: '' })).toBe(
        factory.forConnection(connection)
      );
    });

    it('should let a connection config only tighten the shared ceiling when it sets a stricter limit', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const getSpy = jest.spyOn(registry, 'get');
      const connection = {
        id: 'conn-1',
        config: { rateLimit: { requestsPerMinute: 60, maxConcurrent: 10 } },
      };

      await factory.forConnection(connection, SHOP_CEILING, { bucketKey: 'shop-a' })('a');

      // rpm 60 < 300 tightens; maxConcurrent 10 > 4 must NOT loosen the ceiling.
      expect(getSpy).toHaveBeenCalledWith('shop-a', { requestsPerMinute: 60, maxConcurrent: 4 });
    });

    it('should keep the shared ceiling when a connection config is looser in every knob', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const getSpy = jest.spyOn(registry, 'get');
      const connection = {
        id: 'conn-1',
        config: { rateLimit: { requestsPerMinute: 6000, maxConcurrent: 50 } },
      };

      await factory.forConnection(connection, SHOP_CEILING, { bucketKey: 'shop-a' })('a');

      expect(getSpy).toHaveBeenCalledWith('shop-a', SHOP_CEILING);
    });

    it('should still let an explicit config win outright on the default bucket', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const getSpy = jest.spyOn(registry, 'get');
      const loose = { requestsPerMinute: 6000, maxConcurrent: 50 };

      await factory.forConnection({ id: 'conn-1', config: { rateLimit: loose } }, SHOP_CEILING)('a');

      expect(getSpy).toHaveBeenCalledWith('conn-1', loose);
    });

    it('should keep a shared bucket alive when one of two connections using it is evicted', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const evictSpy = jest.spyOn(registry, 'evict');
      const options = { bucketKey: 'shop-a' };

      const first = factory.forConnection({ id: 'conn-1' }, SHOP_CEILING, options);
      await first('a');
      await factory.forConnection({ id: 'conn-2' }, SHOP_CEILING, options)('b');

      factory.evict('conn-1');

      expect(evictSpy).toHaveBeenCalledWith('conn-1');
      expect(evictSpy).not.toHaveBeenCalledWith('shop-a');
      expect(registry.getStatus('shop-a')).not.toBeNull();
      // The evicted connection's cached shared-bucket fetch is gone too.
      expect(factory.forConnection({ id: 'conn-1' }, SHOP_CEILING, options)).not.toBe(first);
    });

    it('should evict the shared bucket when the last connection using it is evicted', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const factory = new HttpTransportFactory({ registry, fetchImpl });
      const options = { bucketKey: 'shop-a' };

      await factory.forConnection({ id: 'conn-1' }, SHOP_CEILING, options)('a');
      await factory.forConnection({ id: 'conn-2' }, SHOP_CEILING, options)('b');

      factory.evict('conn-1');
      factory.evict('conn-2');

      expect(registry.getStatus('shop-a')).toBeNull();
    });
  });
});
