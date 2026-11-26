/**
 * AmazonSpApiClient tests (#3741 foundation)
 *
 * @module libs/integrations/amazon/src/infrastructure/http/__tests__
 */
import { RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonNetworkError } from '../../../domain/exceptions/amazon-network.error';
import { AmazonSpApiClient, buildAmazonUrl } from '../amazon-spapi-client';

const tokens = { getAccessToken: (): Promise<string> => Promise.resolve('Atza|token') };

function response(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

describe('AmazonSpApiClient', () => {
  it('should send the access token and parse the JSON answer', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(response(200, '{"payload":[]}', { 'x-amzn-RequestId': 'req-1' }));
    const client = new AmazonSpApiClient('sellingpartnerapi-eu.amazon.com', tokens, fetchImpl);

    const result = await client.get('/sellers/v1/marketplaceParticipations');

    expect(result).toEqual({ status: 200, data: { payload: [] }, requestId: 'req-1' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sellingpartnerapi-eu.amazon.com/sellers/v1/marketplaceParticipations');
    expect(init.headers).toMatchObject({ 'x-amz-access-token': 'Atza|token' });
    expect(init.redirect).toBe('manual');
  });

  it('should carry Amazon error code, message and request id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      response(400, '{"errors":[{"code":"InvalidInput","message":"bad marketplace"}]}', {
        'x-amzn-RequestId': 'req-2',
      }),
    );
    const client = new AmazonSpApiClient('h', tokens, fetchImpl);
    const error = await client.get('/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AmazonApiError);
    expect(error).toMatchObject({ statusCode: 400, errorCode: 'InvalidInput', requestId: 'req-2' });
    expect((error as Error).message).toContain('bad marketplace');
  });

  it('should rethrow a rate-limiter rejection unwrapped', async () => {
    const limiterError = new RateLimitTimeoutError(1000);
    const client = new AmazonSpApiClient('h', tokens, jest.fn().mockRejectedValue(limiterError));
    await expect(client.get('/x')).rejects.toBe(limiterError);
  });

  it('should wrap a transport failure as a network error', async () => {
    const client = new AmazonSpApiClient('h', tokens, jest.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(client.get('/x')).rejects.toBeInstanceOf(AmazonNetworkError);
  });

  it('should refuse a 2xx that is not JSON', async () => {
    const client = new AmazonSpApiClient('h', tokens, jest.fn().mockResolvedValue(response(200, '<html>')));
    await expect(client.get('/x')).rejects.toBeInstanceOf(AmazonNetworkError);
  });

  it('should accept an empty 204', async () => {
    const client = new AmazonSpApiClient('h', tokens, jest.fn().mockResolvedValue(response(204, '')));
    await expect(client.delete('/x')).resolves.toMatchObject({ status: 204 });
  });
});

describe('AmazonSpApiClient 401 handling', () => {
  function rotatingTokens(): { source: { getAccessToken: jest.Mock; invalidate: jest.Mock }; minted: string[] } {
    const minted = ['Atza|old', 'Atza|new'];
    let index = 0;
    const source = {
      getAccessToken: jest.fn().mockImplementation(() => Promise.resolve(minted[Math.min(index, minted.length - 1)])),
      invalidate: jest.fn().mockImplementation(() => {
        index += 1;
        return Promise.resolve();
      }),
    };
    return { source, minted };
  }

  it('should invalidate the refused token and retry once with a fresh one', async () => {
    const { source } = rotatingTokens();
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(401, '{"errors":[{"code":"Unauthorized","message":"expired"}]}'))
      .mockResolvedValueOnce(response(200, '{"ok":true}'));
    const client = new AmazonSpApiClient('h', source, fetchImpl);

    const result = await client.put('/x', { a: 1 });

    expect(result.data).toEqual({ ok: true });
    expect(source.invalidate).toHaveBeenCalledWith('Atza|old');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1] as [string, RequestInit])[1].headers).toMatchObject({
      'x-amz-access-token': 'Atza|new',
    });
  });

  it('should surface a second 401 instead of looping', async () => {
    const { source } = rotatingTokens();
    const fetchImpl = jest
      .fn()
      .mockImplementation(() => Promise.resolve(response(401, '{"errors":[{"code":"Unauthorized","message":"no"}]}')));
    const client = new AmazonSpApiClient('h', source, fetchImpl);

    await expect(client.get('/x')).rejects.toMatchObject({ statusCode: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(source.invalidate).toHaveBeenCalledTimes(1);
  });

  it('should renew the token once on 403 Unauthorized, as the sandbox answers a bad token', async () => {
    const { source } = rotatingTokens();
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(403, '{"errors":[{"code":"Unauthorized","message":"denied","details":"The access token you provided is revoked, malformed or invalid."}]}'))
      .mockResolvedValueOnce(response(200, '{"ok":true}'));
    const client = new AmazonSpApiClient('h', source, fetchImpl);

    await expect(client.get('/x')).resolves.toMatchObject({ data: { ok: true } });
    expect(source.invalidate).toHaveBeenCalledWith('Atza|old');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('should surface a 403 Unauthorized that repeats (a missing role), after one renewal', async () => {
    const { source } = rotatingTokens();
    const fetchImpl = jest
      .fn()
      .mockImplementation(() => Promise.resolve(response(403, '{"errors":[{"code":"Unauthorized","message":"role"}]}')));
    const client = new AmazonSpApiClient('h', source, fetchImpl);

    await expect(client.get('/x')).rejects.toMatchObject({ statusCode: 403 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('should not renew the token on a 403 with another code', async () => {
    const { source } = rotatingTokens();
    const fetchImpl = jest.fn().mockResolvedValue(response(403, '{"errors":[{"code":"AccessDenied","message":"x"}]}'));
    const client = new AmazonSpApiClient('h', source, fetchImpl);

    await expect(client.get('/x')).rejects.toMatchObject({ statusCode: 403 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('should not retry when the token source cannot forget a token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(401, '{"errors":[{"code":"Unauthorized"}]}'));
    const client = new AmazonSpApiClient('h', tokens, fetchImpl);

    await expect(client.get('/x')).rejects.toBeInstanceOf(AmazonApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('buildAmazonUrl', () => {
  it('should comma-join list parameters and drop undefined ones', () => {
    expect(
      buildAmazonUrl('h', 'orders', { marketplaceIds: ['A1', 'A2'], nextToken: undefined, limit: 20 }),
    ).toBe('https://h/orders?marketplaceIds=A1%2CA2&limit=20');
  });
});
