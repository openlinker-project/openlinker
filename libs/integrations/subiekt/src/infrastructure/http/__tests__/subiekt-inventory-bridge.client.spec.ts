/**
 * Subiekt Inventory Bridge HTTP Client — unit tests (#3373)
 *
 * Before this file existed, `SubiektInventoryMasterAdapter`'s own spec mocked
 * `SubiektInventoryBridgeClient` wholesale, so this class's own fetch/catch/
 * retryability-classification code (the exact shape #3369's B2 fix targeted)
 * had zero direct or indirect test coverage anywhere in the package.
 *
 * @module libs/integrations/subiekt/src/infrastructure/http/__tests__
 */
import type { FetchLike } from '@openlinker/shared/http';
import { SubiektRejectedError } from '../../../bridge/subiekt-bridge.errors';
import { SubiektBridgeAuthError } from '../../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektBridgeUnreachableWithPhaseError } from '../../../bridge/subiekt-transport-retryability';
import { SubiektInventoryBridgeClient } from '../subiekt-inventory-bridge.client';

const BASE = 'http://192.168.1.10:5056';

function okResponse(data: unknown): Response {
  return {
    status: 200,
    json: (): Promise<unknown> => Promise.resolve({ success: true, data, error: null }),
  } as unknown as Response;
}

function errorResponse(status: number, reason: string): Response {
  return {
    status,
    json: (): Promise<unknown> =>
      Promise.resolve({ success: false, data: null, error: { code: 'bad_request', reason, correlationId: null } }),
  } as unknown as Response;
}

/** Real `fetch` throw shape — the code lives on `error.cause.code`, never `.message`. */
function transportFailure(code: string): FetchLike {
  return (() =>
    Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code } }))) as FetchLike;
}

function buildClient(fetchImpl: FetchLike): SubiektInventoryBridgeClient {
  return new SubiektInventoryBridgeClient(BASE, { fetchImpl });
}

describe('SubiektInventoryBridgeClient', () => {
  describe('retryability phase classification (#3369 B2, #3373)', () => {
    it("classifies ECONNREFUSED -> retryability 'safe'", async () => {
      const client = buildClient(transportFailure('ECONNREFUSED'));
      const rejection = client.getStock('SKU-1');
      await expect(rejection).rejects.toBeInstanceOf(SubiektBridgeUnreachableWithPhaseError);
      await rejection.catch((err: SubiektBridgeUnreachableWithPhaseError) => {
        expect(err.retryability).toBe('safe');
      });
    });

    it("classifies ENOTFOUND -> retryability 'safe'", async () => {
      const client = buildClient(transportFailure('ENOTFOUND'));
      const rejection = client.getStock('SKU-1');
      await rejection.catch((err: SubiektBridgeUnreachableWithPhaseError) => {
        expect(err.retryability).toBe('safe');
      });
    });

    it("classifies ECONNRESET -> retryability 'indeterminate'", async () => {
      const client = buildClient(transportFailure('ECONNRESET'));
      const rejection = client.adjust({ towarSymbol: 'SKU-1', delta: 1 });
      await rejection.catch((err: SubiektBridgeUnreachableWithPhaseError) => {
        expect(err.retryability).toBe('indeterminate');
      });
    });

    it("classifies AbortError/timeout -> retryability 'indeterminate'", async () => {
      const fetchImpl = (() =>
        Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))) as FetchLike;
      const client = buildClient(fetchImpl);
      const rejection = client.getStock('SKU-1');
      await rejection.catch((err: SubiektBridgeUnreachableWithPhaseError) => {
        expect(err.retryability).toBe('indeterminate');
      });
    });

    it('an unparseable JSON response stays indeterminate (response WAS received)', async () => {
      const fetchImpl = (() =>
        Promise.resolve({
          status: 200,
          json: (): Promise<unknown> => Promise.reject(new Error('not json')),
        } as unknown as Response)) as FetchLike;
      const client = buildClient(fetchImpl);
      const rejection = client.getStock('SKU-1');
      await rejection.catch((err: SubiektBridgeUnreachableWithPhaseError) => {
        expect(err.retryability).toBe('indeterminate');
      });
    });
  });

  describe('auth failure', () => {
    it('401 throws SubiektBridgeAuthError', async () => {
      const client = buildClient((() => Promise.resolve(errorResponse(401, 'bad token'))) as FetchLike);
      await expect(client.getStock('SKU-1')).rejects.toBeInstanceOf(SubiektBridgeAuthError);
    });
  });

  describe('business rejection', () => {
    it('a structured rejection envelope surfaces its real reason (not a generic HTTP status)', async () => {
      const client = buildClient(
        (() => Promise.resolve(errorResponse(422, 'Towar nie znaleziono'))) as FetchLike,
      );
      const rejection = client.getStock('SKU-GONE');
      await expect(rejection).rejects.toBeInstanceOf(SubiektRejectedError);
      await rejection.catch((err: SubiektRejectedError) => {
        expect(err.reason).toBe('Towar nie znaleziono');
      });
    });
  });

  describe('happy path', () => {
    it('getStock unwraps the envelope', async () => {
      const client = buildClient((() => Promise.resolve(okResponse({ positions: [] }))) as FetchLike);
      await expect(client.getStock('SKU-1')).resolves.toEqual({ positions: [] });
    });
  });
});
