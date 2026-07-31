/**
 * Http Transport Factory Unit Tests
 *
 * @module libs/shared/src/http
 */
import { HttpTransportFactory } from '../http-transport-factory';
import { createRateLimiterRegistry } from '../../rate-limit';
import type { RateLimiterRegistry } from '../../rate-limit';

describe('HttpTransportFactory', () => {
  let registry: RateLimiterRegistry;

  beforeEach(() => {
    registry = createRateLimiterRegistry();
  });

  it('returns a stable FetchLike reference per connection, not a new closure per call', () => {
    const factory = new HttpTransportFactory({ registry });
    const connection = { id: 'conn-1' };

    const first = factory.for(connection);
    const second = factory.for(connection);

    expect(first).toBe(second);
  });

  it('delegates to the injected fetchImpl and releases the slot on success', async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 1 } } };
    const boundFetch = factory.for(connection);

    const result = await boundFetch('https://example.com');

    expect(fetchImpl).toHaveBeenCalledWith('https://example.com', undefined);
    expect(result).toBe(response);
    expect(registry.getStatus('conn-1')?.inFlight).toBe(0);
  });

  it('releases the slot even when the underlying fetch throws', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const factory = new HttpTransportFactory({ registry, fetchImpl });

    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 1 } } };
    const boundFetch = factory.for(connection);

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
    const boundFetch = factory.for(connection);

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
    const boundFetch = factory.for(connection);

    await Promise.all([boundFetch('a'), boundFetch('b'), boundFetch('c')]);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('divides the configured cap across OL_WORKER_REPLICAS', async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const factory = new HttpTransportFactory({ registry, fetchImpl, replicas: 4 });

    const connection = { id: 'conn-1', config: { rateLimit: { maxConcurrent: 4 } } };
    const boundFetch = factory.for(connection);

    await boundFetch('https://example.com');

    // 4 replicas dividing a cap of 4 leaves each replica a cap of 1.
    expect(registry.getStatus('conn-1')?.maxConcurrent).toBe(1);
  });
});
