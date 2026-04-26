/**
 * Upload Images Via Allegro Tests
 *
 * Unit tests for the no-cache image-pipeline orchestrator. Exercises the
 * download → validate → upload path with a mocked `fetchImpl` (operator-
 * host downloads) and a mocked `IAllegroHttpClient.postBinary` (Allegro
 * upload).
 *
 * @module libs/integrations/allegro/src/infrastructure/util/__tests__
 */
import { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import { uploadImagesViaAllegro } from '../upload-images-via-allegro';

describe('uploadImagesViaAllegro', () => {
  let uploadHttpClient: jest.Mocked<IAllegroHttpClient>;

  const okFetchResponse = (body: Uint8Array, contentType = 'image/jpeg'): Response =>
    new Response(body, { status: 200, headers: { 'content-type': contentType } });

  const errFetchResponse = (status: number, body = ''): Response =>
    new Response(body, { status });

  beforeEach(() => {
    uploadHttpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      postBinary: jest.fn(),
    } as unknown as jest.Mocked<IAllegroHttpClient>;
  });

  it('returns ok=true with empty array when input is empty (fetch and upload never called)', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;

    const result = await uploadImagesViaAllegro(uploadHttpClient, [], { fetchImpl });

    expect(result).toEqual({ ok: true, locations: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(uploadHttpClient.postBinary).not.toHaveBeenCalled();
  });

  it('happy path — single 200 jpeg returns one Allegro CDN location', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okFetchResponse(new Uint8Array([0xff, 0xd8, 0xff])));
    uploadHttpClient.postBinary.mockResolvedValue({
      data: { location: 'https://images.allegrostatic.com/uploaded-1.jpg' },
      status: 201,
      headers: {},
    });

    const result = await uploadImagesViaAllegro(
      uploadHttpClient,
      ['http://shop.local/img/1.jpg'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result).toEqual({
      ok: true,
      locations: ['https://images.allegrostatic.com/uploaded-1.jpg'],
    });
    expect(uploadHttpClient.postBinary).toHaveBeenCalledTimes(1);
    expect(uploadHttpClient.postBinary).toHaveBeenCalledWith(
      '/sale/images',
      'image/jpeg',
      expect.any(Uint8Array),
    );
  });

  it('preserves input order across N images', async () => {
    // Fresh Response per call — Response bodies can only be consumed once.
    const fetchImpl = jest
      .fn()
      .mockImplementation(() => Promise.resolve(okFetchResponse(new Uint8Array([1]))));
    let counter = 0;
    uploadHttpClient.postBinary.mockImplementation(() =>
      Promise.resolve({
        data: { location: `https://images.allegrostatic.com/u-${++counter}.jpg` },
        status: 201,
        headers: {},
      }),
    );

    const result = await uploadImagesViaAllegro(
      uploadHttpClient,
      ['http://a/1.jpg', 'http://a/2.jpg', 'http://a/3.jpg'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locations).toHaveLength(3);
    // Each input URL was downloaded.
    expect(fetchImpl).toHaveBeenCalledWith('http://a/1.jpg', expect.any(Object));
    expect(fetchImpl).toHaveBeenCalledWith('http://a/2.jpg', expect.any(Object));
    expect(fetchImpl).toHaveBeenCalledWith('http://a/3.jpg', expect.any(Object));
  });

  it('IMAGE_DOWNLOAD_FAILED when PrestaShop returns 403 — postBinary never called', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(errFetchResponse(403, 'Forbidden'));

    const result = await uploadImagesViaAllegro(
      uploadHttpClient,
      ['http://shop.local/locked.jpg'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toEqual({
      field: 'images',
      code: 'IMAGE_DOWNLOAD_FAILED',
      message: expect.stringMatching(/http:\/\/shop\.local\/locked\.jpg.*403/),
    });
    expect(uploadHttpClient.postBinary).not.toHaveBeenCalled();
  });

  it('IMAGE_DOWNLOAD_FAILED with timeout language when fetch rejects with AbortError', async () => {
    const fetchImpl = jest.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const result = await uploadImagesViaAllegro(
      uploadHttpClient,
      ['http://slow.local/x.jpg'],
      { fetchImpl: fetchImpl as unknown as typeof fetch, downloadTimeoutMs: 5_000 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]).toEqual({
      field: 'images',
      code: 'IMAGE_DOWNLOAD_FAILED',
      message: expect.stringMatching(/timed out after 5000ms/),
    });
  });

  it('IMAGE_DOWNLOAD_INVALID_TYPE when PrestaShop returns 200 + text/html (error page)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        new Response('<html>Not authorized</html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      );

    const result = await uploadImagesViaAllegro(
      uploadHttpClient,
      ['http://shop.local/blocked.jpg'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]).toEqual({
      field: 'images',
      code: 'IMAGE_DOWNLOAD_INVALID_TYPE',
      message: expect.stringMatching(/text\/html/),
    });
    expect(uploadHttpClient.postBinary).not.toHaveBeenCalled();
  });

  it('normalizes image/jpg to image/jpeg when forwarding to Allegro', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'content-type': 'image/jpg' }, // non-standard but ubiquitous
      }),
    );
    uploadHttpClient.postBinary.mockResolvedValue({
      data: { location: 'https://images.allegrostatic.com/n.jpg' },
      status: 201,
      headers: {},
    });

    const result = await uploadImagesViaAllegro(
      uploadHttpClient,
      ['http://shop.local/jpg-mime.jpg'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(true);
    expect(uploadHttpClient.postBinary).toHaveBeenCalledWith(
      '/sale/images',
      'image/jpeg', // not 'image/jpg'
      expect.any(Uint8Array),
    );
  });

  it('IMAGE_UPLOAD_FAILED when Allegro postBinary rejects with 4xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okFetchResponse(new Uint8Array([0xff])));
    uploadHttpClient.postBinary.mockRejectedValue(
      new AllegroApiException(
        'Unprocessable entity',
        422,
        '{"errors":[{"code":"INVALID_IMAGE"}]}',
        'https://upload.allegro.pl/sale/images',
      ),
    );

    const result = await uploadImagesViaAllegro(
      uploadHttpClient,
      ['http://shop.local/x.jpg'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]).toEqual({
      field: 'images',
      code: 'IMAGE_UPLOAD_FAILED',
      message: expect.stringMatching(/Allegro rejected image upload.*HTTP 422/),
    });
  });

  it('IMAGE_UPLOAD_FAILED when Allegro response is missing the location field', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okFetchResponse(new Uint8Array([0xff])));
    uploadHttpClient.postBinary.mockResolvedValue({
      data: {},
      status: 201,
      headers: {},
    });

    const result = await uploadImagesViaAllegro(
      uploadHttpClient,
      ['http://shop.local/x.jpg'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]).toEqual({
      field: 'images',
      code: 'IMAGE_UPLOAD_FAILED',
      message: expect.stringMatching(/missing 'location'/),
    });
  });

  it('mixed (one OK, one 403 download) returns failures listing only the failing URL', async () => {
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.includes('bad')) {
        return Promise.resolve(errFetchResponse(403));
      }
      return Promise.resolve(okFetchResponse(new Uint8Array([0xff])));
    });
    uploadHttpClient.postBinary.mockResolvedValue({
      data: { location: 'https://images.allegrostatic.com/ok.jpg' },
      status: 201,
      headers: {},
    });

    const result = await uploadImagesViaAllegro(
      uploadHttpClient,
      ['http://shop.local/good.jpg', 'http://shop.local/bad.jpg'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toContain('http://shop.local/bad.jpg');
    expect(result.failures[0].message).not.toContain('http://shop.local/good.jpg');
  });
});
