/**
 * Subiekt Orders Bridge HTTP Client — unit tests (#3373)
 *
 * Before this file existed, this client's transport/classification code had
 * zero direct or indirect coverage — `subiekt-order-processor.adapter.spec.ts`
 * / `subiekt-order-source.adapter.spec.ts` never simulate a transport
 * failure. This is also the client whose own consumer (#3369) had no error
 * translation at all, silently discarding the phase this file proves is
 * classified correctly right here at the transport boundary.
 *
 * @module libs/integrations/subiekt/bridge/__tests__
 */
import type { FetchLike } from '@openlinker/shared/http';
import { SubiektRejectedError } from '../subiekt-bridge.errors';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektBridgeUnreachableWithPhaseError } from '../subiekt-transport-retryability';
import { SubiektOrdersBridgeClient } from '../subiekt-orders-bridge.client';

const BASE = 'http://192.168.1.10:5055';

function okResponse(data: unknown): Response {
  return {
    status: 200,
    ok: true,
    json: (): Promise<unknown> => Promise.resolve({ success: true, data, error: null }),
  } as unknown as Response;
}

function errorResponse(status: number, reason: string): Response {
  return {
    status,
    ok: false,
    json: (): Promise<unknown> =>
      Promise.resolve({ success: false, data: null, error: { code: 'bad_request', reason } }),
  } as unknown as Response;
}

function transportFailure(code: string): FetchLike {
  return (() =>
    Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code } }))) as FetchLike;
}

function buildClient(fetchImpl: FetchLike): SubiektOrdersBridgeClient {
  return new SubiektOrdersBridgeClient(BASE, { fetchImpl });
}

describe('SubiektOrdersBridgeClient', () => {
  describe('retryability phase classification (#3369 B2, #3373)', () => {
    it("classifies ECONNREFUSED -> retryability 'safe'", async () => {
      const client = buildClient(transportFailure('ECONNREFUSED'));
      const rejection = client.getOrder('1');
      await expect(rejection).rejects.toBeInstanceOf(SubiektBridgeUnreachableWithPhaseError);
      await rejection.catch((err: SubiektBridgeUnreachableWithPhaseError) => {
        expect(err.retryability).toBe('safe');
      });
    });

    it("classifies ECONNRESET -> retryability 'indeterminate' — the ambiguous case createOrder must never auto-retry", async () => {
      const client = buildClient(transportFailure('ECONNRESET'));
      const rejection = client.createOrder({
        orderRef: 'ol_order_1',
        buyer: { nazwa: 'Jan Kowalski', nip: null },
        lines: [{ symbol: 'SKU-1', ilosc: 1, wartoscBrutto: 10 }],
      });
      await rejection.catch((err: SubiektBridgeUnreachableWithPhaseError) => {
        expect(err.retryability).toBe('indeterminate');
      });
    });

    it("classifies AbortError/timeout -> retryability 'indeterminate'", async () => {
      const fetchImpl = (() =>
        Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))) as FetchLike;
      const client = buildClient(fetchImpl);
      const rejection = client.getOrder('1');
      await rejection.catch((err: SubiektBridgeUnreachableWithPhaseError) => {
        expect(err.retryability).toBe('indeterminate');
      });
    });

    it('an unparseable JSON response stays indeterminate', async () => {
      const fetchImpl = (() =>
        Promise.resolve({
          status: 200,
          ok: true,
          json: (): Promise<unknown> => Promise.reject(new Error('not json')),
        } as unknown as Response)) as FetchLike;
      const client = buildClient(fetchImpl);
      const rejection = client.getOrder('1');
      await rejection.catch((err: SubiektBridgeUnreachableWithPhaseError) => {
        expect(err.retryability).toBe('indeterminate');
      });
    });
  });

  describe('auth failure', () => {
    it('403 throws SubiektBridgeAuthError', async () => {
      const client = buildClient((() => Promise.resolve(errorResponse(403, 'forbidden'))) as FetchLike);
      await expect(client.getOrder('1')).rejects.toBeInstanceOf(SubiektBridgeAuthError);
    });
  });

  describe('business rejection', () => {
    it('a rejected create surfaces its real reason', async () => {
      const client = buildClient(
        (() => Promise.resolve(errorResponse(422, 'Nieprawidlowy kontrahent'))) as FetchLike,
      );
      const rejection = client.getOrder('1');
      await expect(rejection).rejects.toBeInstanceOf(SubiektRejectedError);
      await rejection.catch((err: SubiektRejectedError) => {
        expect(err.reason).toBe('Nieprawidlowy kontrahent');
      });
    });
  });

  describe('happy path', () => {
    it('getOrder unwraps the envelope', async () => {
      const client = buildClient((() => Promise.resolve(okResponse({ id: '1' }))) as FetchLike);
      await expect(client.getOrder('1')).resolves.toEqual({ id: '1' });
    });
  });
});
