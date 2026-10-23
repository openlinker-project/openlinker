/**
 * eparagony.pl Document Status Reader - unit tests (#3192)
 *
 * The transport both document lanes share. The clamp is the part that earns a
 * spec of its own: `MAX_STATUS_POLL_TIMEOUT_MS` is what guarantees a single call
 * cannot outlive core's in-flight lease and register or issue the same sale
 * twice, and before this file neither boundary of it was tested on either lane.
 *
 * @module libs/integrations/eparagony/src/infrastructure/http/__tests__
 */
import { EparagonyApiError } from '../../../domain/exceptions/eparagony-api.error';
import { EparagonyNetworkError } from '../../../domain/exceptions/eparagony-network.error';
import type { IEparagonyHttpClient } from '../eparagony-http-client.interface';
import type { EparagonyHttpResponse } from '../eparagony-http-client.types';
import {
  MAX_STATUS_POLL_TIMEOUT_MS,
  MIN_STATUS_POLL_TIMEOUT_MS,
  readEparagonyDocumentStatus,
  resolveStatusPollTimeoutMs,
} from '../eparagony-document-status.reader';

const DEFAULT_MS = 45_000;
const TOKEN = '03f75ffc-4808-4135-b8fe-b79451c1245f';

function makeClient(get: jest.Mock): IEparagonyHttpClient {
  return {
    post: jest.fn(),
    get,
    invalidateToken: jest.fn(),
    ensureToken: jest.fn().mockResolvedValue(undefined),
  } as unknown as IEparagonyHttpClient;
}

function ok(data: unknown): Promise<EparagonyHttpResponse<unknown>> {
  return Promise.resolve({ status: 200, data } as EparagonyHttpResponse<unknown>);
}

describe('resolveStatusPollTimeoutMs', () => {
  it("should return the caller's own default when nothing is configured", () => {
    // The default is per LANE - a receipt is registered on a device and an
    // invoice is composed and relayed - which is why it is an argument.
    expect(resolveStatusPollTimeoutMs(undefined, DEFAULT_MS)).toBe(DEFAULT_MS);
    expect(resolveStatusPollTimeoutMs(undefined, 60_000)).toBe(60_000);
  });

  it('should clamp a configured value UP to the floor, so a poll cannot give up mid-answer', () => {
    expect(resolveStatusPollTimeoutMs(1, DEFAULT_MS)).toBe(MIN_STATUS_POLL_TIMEOUT_MS);
    expect(resolveStatusPollTimeoutMs(-1, DEFAULT_MS)).toBe(MIN_STATUS_POLL_TIMEOUT_MS);
    expect(resolveStatusPollTimeoutMs(0, DEFAULT_MS)).toBe(MIN_STATUS_POLL_TIMEOUT_MS);
  });

  it('should clamp a configured value DOWN to the ceiling, which is the fiscal-safety half', () => {
    // Above the ceiling one call can outlive core's in-flight lease, the lease
    // can be re-claimed while it is still in flight, and one sale gets two
    // documents. `999_999` in a JSONB config is one raw-editor keystroke away.
    expect(resolveStatusPollTimeoutMs(999_999, DEFAULT_MS)).toBe(MAX_STATUS_POLL_TIMEOUT_MS);
    expect(resolveStatusPollTimeoutMs(Number.MAX_SAFE_INTEGER, DEFAULT_MS)).toBe(
      MAX_STATUS_POLL_TIMEOUT_MS,
    );
  });

  it('should pass a value already inside the range through unchanged', () => {
    expect(resolveStatusPollTimeoutMs(30_000, DEFAULT_MS)).toBe(30_000);
    expect(resolveStatusPollTimeoutMs(MIN_STATUS_POLL_TIMEOUT_MS, DEFAULT_MS)).toBe(
      MIN_STATUS_POLL_TIMEOUT_MS,
    );
    expect(resolveStatusPollTimeoutMs(MAX_STATUS_POLL_TIMEOUT_MS, DEFAULT_MS)).toBe(
      MAX_STATUS_POLL_TIMEOUT_MS,
    );
  });

  it('should fall back to the default for a value that is not a finite number', () => {
    // `config` is JSONB, so a string or a NaN is reachable. Refusing to register
    // a real sale over a mistyped timeout would be the worse failure.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '30000', null, {}]) {
      expect(resolveStatusPollTimeoutMs(bad as unknown as number, DEFAULT_MS)).toBe(DEFAULT_MS);
    }
  });
});

describe('readEparagonyDocumentStatus', () => {
  it('should read the status off the shared documents path', async () => {
    const get = jest.fn().mockImplementation(() => ok({ status: 'OFFLINE' }));
    const body = await readEparagonyDocumentStatus(makeClient(get), TOKEN, {
      treatUnknownDocumentAsMissing: false,
    });

    expect(get).toHaveBeenCalledWith(`documents/${encodeURIComponent(TOKEN)}/status`);
    expect(body).toEqual({ status: 'OFFLINE' });
  });

  it.each([
    ['a string', 'nope'],
    ['an array', []],
    ['null', null],
  ])(
    'should treat %s body as a contract break and therefore as IN-DOUBT, never as a verdict',
    async (_label, data) => {
      const get = jest.fn().mockImplementation(() => ok(data));
      await expect(
        readEparagonyDocumentStatus(makeClient(get), TOKEN, {
          treatUnknownDocumentAsMissing: false,
        }),
      ).rejects.toBeInstanceOf(EparagonyNetworkError);
    },
  );

  it('should convert the unknown-document rejection into null ONLY when asked', async () => {
    const unknown = new EparagonyApiError('unknown token', 404, { errorCode: 92 });
    const get = jest.fn().mockImplementation(() => Promise.reject(unknown));

    await expect(
      readEparagonyDocumentStatus(makeClient(get), TOKEN, { treatUnknownDocumentAsMissing: true }),
    ).resolves.toBeNull();

    // An issuance poll never asks for it: a document that vanished mid-poll is
    // not a clean absence and must stay in doubt.
    await expect(
      readEparagonyDocumentStatus(makeClient(get), TOKEN, { treatUnknownDocumentAsMissing: false }),
    ).rejects.toBe(unknown);
  });

  it('should propagate any other rejection even when absences are tolerated', async () => {
    const other = new EparagonyApiError('rate limited', 429, { errorCode: 7 });
    const get = jest.fn().mockImplementation(() => Promise.reject(other));
    await expect(
      readEparagonyDocumentStatus(makeClient(get), TOKEN, { treatUnknownDocumentAsMissing: true }),
    ).rejects.toBe(other);
  });
});
