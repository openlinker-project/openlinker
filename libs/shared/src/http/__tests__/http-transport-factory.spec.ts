/**
 * Http Transport Factory Unit Tests
 *
 * @module libs/shared/src/http
 */
import { HttpTransportFactory } from '../http-transport-factory';
import { createRateLimiterRegistry, runWithPriority } from '../../rate-limit';
import type { RateLimiterRegistry } from '../../rate-limit';

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

  it('divides the configured cap across OL_WORKER_REPLICAS', async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl, replicas: 4 });

    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 4 } } };
    const boundFetch = factory.forConnection(connection);

    await boundFetch('https://example.com');

    // 4 replicas dividing a cap of 4 leaves each replica a cap of 1.
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
});
