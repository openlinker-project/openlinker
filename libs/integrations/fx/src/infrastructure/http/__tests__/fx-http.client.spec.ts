/**
 * FX HTTP Client Tests
 *
 * Covers the two properties the adapters depend on and cannot assert for
 * themselves: what every outbound FX request identifies itself as, and which
 * statuses count as "come back later" (#2135 review, findings 1 and 2).
 *
 * @module libs/integrations/fx/infrastructure/http/__tests__
 */
import type { FetchLike } from '@openlinker/shared/http';
import {
  FX_TRANSIENT_STATUS_CODES,
  FX_USER_AGENT,
  FxTransportError,
  fxGet,
  isTransientFxStatus,
} from '../fx-http.client';

function recordingFetch(): { fetchImpl: FetchLike; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const fetchImpl = ((_input: unknown, init: RequestInit) => {
    calls.push(init);
    return Promise.resolve({
      status: 200,
      text: () => Promise.resolve('ok'),
    } as unknown as Response);
  }) as unknown as FetchLike;

  return { fetchImpl, calls };
}

describe('fxGet', () => {
  it('should identify OpenLinker with a user-agent on every request', async () => {
    // Not cosmetic: NBP and ECB are public unauthenticated endpoints, and the
    // usual mitigation against an anonymous UA-less client is a throttle or an
    // outright filter - which this package cannot absorb locally because it
    // deliberately carries no retry loop. `undici` sends no default UA at all,
    // so this header is the only one either provider ever sees.
    const { fetchImpl, calls } = recordingFetch();

    await fxGet(fetchImpl, 'https://example.test/rates');

    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers['user-agent']).toBe(FX_USER_AGENT);
    expect(headers['user-agent']).toContain('OpenLinker');
  });

  it('should still send the accept header alongside the user-agent', async () => {
    const { fetchImpl, calls } = recordingFetch();

    await fxGet(fetchImpl, 'https://example.test/rates');

    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers.accept).toContain('application/json');
  });

  it('should wrap a transport failure as FxTransportError', async () => {
    const fetchImpl = (() => Promise.reject(new Error('ECONNRESET'))) as unknown as FetchLike;

    await expect(fxGet(fetchImpl, 'https://example.test/rates')).rejects.toThrow(FxTransportError);
  });
});

describe('isTransientFxStatus', () => {
  it.each(FX_TRANSIENT_STATUS_CODES)('should treat %i as transient', (status: number) => {
    // The whole point of finding 1: these two 4xx codes mean "come back later",
    // and classifying them terminal writes the order's permanent `fxStampedAt`
    // marker with no figure and no recovery route other than the sweep cooldown.
    expect(isTransientFxStatus(status)).toBe(true);
  });

  it.each([500, 502, 503, 504])('should treat %i as transient', (status: number) => {
    expect(isTransientFxStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 406, 422])(
    'should leave %i to the adapter as a terminal answer',
    (status: number) => {
      expect(isTransientFxStatus(status)).toBe(false);
    }
  );

  it('should not treat a success status as transient', () => {
    expect(isTransientFxStatus(200)).toBe(false);
  });
});
