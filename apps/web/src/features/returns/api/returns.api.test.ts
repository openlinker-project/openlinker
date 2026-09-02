import { describe, it, expect, vi } from 'vitest';
import { createReturnsApi } from './returns.api';
import { RETURNS_MAX_LIMIT } from './returns.types';

function envelope(): unknown {
  return {
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
    counts: { total: 0, orphan: 0, attributed: 0 },
  };
}

describe('createReturnsApi.list', () => {
  it('should send no query string when nothing is filtered or paged', async () => {
    const request = vi.fn().mockResolvedValue(envelope());

    await createReturnsApi(request).list();

    expect(request).toHaveBeenCalledWith('/returns');
  });

  it('should forward every declared filter', async () => {
    const request = vi.fn().mockResolvedValue(envelope());

    await createReturnsApi(request).list(
      {
        bucket: 'orphan',
        sourceConnectionId: 'conn_1',
        createdFrom: '2026-01-01T00:00:00.000Z',
        createdTo: '2026-02-01T00:00:00.000Z',
      },
      { limit: 20, offset: 40 },
    );

    const [path] = request.mock.calls[0] as [string];
    const query = new URLSearchParams(path.split('?')[1]);
    expect(query.get('bucket')).toBe('orphan');
    expect(query.get('sourceConnectionId')).toBe('conn_1');
    expect(query.get('createdFrom')).toBe('2026-01-01T00:00:00.000Z');
    expect(query.get('createdTo')).toBe('2026-02-01T00:00:00.000Z');
    expect(query.get('limit')).toBe('20');
    expect(query.get('offset')).toBe('40');
  });

  it('should clamp an over-large limit rather than letting the backend 400 the page', async () => {
    const request = vi.fn().mockResolvedValue(envelope());

    await createReturnsApi(request).list(undefined, { limit: 500 });

    const [path] = request.mock.calls[0] as [string];
    expect(new URLSearchParams(path.split('?')[1]).get('limit')).toBe(String(RETURNS_MAX_LIMIT));
  });

  it('should report the paging the server applied, not the paging requested', async () => {
    // The controller fills its own defaults, so echoing the request would report
    // `limit: 0` for a call that omitted it while the server used 20.
    const request = vi.fn().mockResolvedValue({ ...(envelope() as object), limit: 20, offset: 0 });

    const result = await createReturnsApi(request).list();

    expect(result.limit).toBe(20);
  });

  it('should fall back to the requested paging when the server does not echo it', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ...(envelope() as object), limit: null, offset: null });

    const result = await createReturnsApi(request).list(undefined, { limit: 20, offset: 40 });

    expect(result.limit).toBe(20);
    expect(result.offset).toBe(40);
  });
});

describe('createReturnsApi.getIngestionAvailability', () => {
  it('should read the availability fact', async () => {
    const request = vi.fn().mockResolvedValue({ configured: true, connectionIds: ['conn_1'] });

    const result = await createReturnsApi(request).getIngestionAvailability();

    expect(request).toHaveBeenCalledWith('/returns/ingestion-availability');
    expect(result).toEqual({ configured: true, connectionIds: ['conn_1'] });
  });

  it('should resolve null rather than configured: false for an unreadable response', async () => {
    const request = vi.fn().mockResolvedValue({ nonsense: true });

    expect(await createReturnsApi(request).getIngestionAvailability()).toBeNull();
  });
});
