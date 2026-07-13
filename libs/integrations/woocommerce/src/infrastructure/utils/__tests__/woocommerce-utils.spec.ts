/**
 * @module libs/integrations/woocommerce/src/infrastructure/utils/__tests__
 */
import { fetchAllPages, FETCH_ALL_MAX_PAGES, normGmt, toPositiveInt } from '../woocommerce-utils';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import { WooCommerceInvalidIdentifierException } from '../../../domain/exceptions/woocommerce-invalid-identifier.exception';
import { Logger } from '@openlinker/shared/logging';

function makeHttpClient(pages: unknown[][]): jest.Mocked<IWooCommerceHttpClient> {
  let call = 0;
  return {
    get: jest.fn().mockImplementation(() => Promise.resolve(pages[call++] ?? [])),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<IWooCommerceHttpClient>;
}

const logger = new Logger('test');

describe('toPositiveInt', () => {
  it('should return the integer for a positive numeric string', () => {
    expect(toPositiveInt('42')).toBe(42);
  });

  it('should return the integer for a positive number', () => {
    expect(toPositiveInt(7)).toBe(7);
  });

  it.each([null, undefined, '', 'abc', NaN, Infinity, 0, -1, '-5', '12.9', 12.9])(
    'should throw WooCommerceInvalidIdentifierException for invalid input %p',
    (value) => {
      expect(() => toPositiveInt(value)).toThrow(WooCommerceInvalidIdentifierException);
    },
  );

  it('should weave the label into the error message', () => {
    expect(() => toPositiveInt('NaN', 'variation id')).toThrow(/variation id/);
  });
});

describe('fetchAllPages', () => {
  it('should return items and stop after a single page when fewer than perPage items', async () => {
    const items = [{ id: 1 }, { id: 2 }];
    const httpClient = makeHttpClient([[...items]]);

    const result = await fetchAllPages('/wp-json/wc/v3/products/1/variations', httpClient, logger, 100);

    expect(result).toEqual(items);
    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(httpClient.get).toHaveBeenCalledWith(
      '/wp-json/wc/v3/products/1/variations',
      { per_page: 100, page: 1 },
    );
  });

  it('should accumulate items across multiple pages and stop when last page is partial', async () => {
    const page1 = Array.from({ length: 2 }, (_, i) => ({ id: i + 1 }));
    const page2 = [{ id: 3 }]; // fewer than perPage=2 → stop
    const httpClient = makeHttpClient([page1, page2]);

    const result = await fetchAllPages('/wp-json/wc/v3/test', httpClient, logger, 2);

    expect(result).toHaveLength(3);
    expect(httpClient.get).toHaveBeenCalledTimes(2);
    expect(httpClient.get).toHaveBeenNthCalledWith(2, '/wp-json/wc/v3/test', { per_page: 2, page: 2 });
  });

  it('should warn and truncate when hitting the MAX_PAGES safety cap', async () => {
    // Return full pages every time so the loop never breaks early
    const fullPage = Array.from({ length: 1 }, (_, i) => ({ id: i }));
    const pages = Array.from({ length: FETCH_ALL_MAX_PAGES + 1 }, () => [...fullPage]);
    const httpClient = makeHttpClient(pages);
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = await fetchAllPages('/wp-json/wc/v3/test', httpClient, logger, 1);

    expect(httpClient.get).toHaveBeenCalledTimes(FETCH_ALL_MAX_PAGES);
    expect(result).toHaveLength(FETCH_ALL_MAX_PAGES);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('MAX_PAGES'));
    warnSpy.mockRestore();
  });

  it('should return an empty array when the first page is empty', async () => {
    const httpClient = makeHttpClient([[]]);

    const result = await fetchAllPages('/wp-json/wc/v3/test', httpClient, logger);

    expect(result).toEqual([]);
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });
});

describe('normGmt', () => {
  it('should append Z when gmt field is present without Z', () => {
    expect(normGmt('2024-01-15T10:30:00', '')).toBe('2024-01-15T10:30:00Z');
  });

  it('should fall back to local field + Z when gmt is absent', () => {
    expect(normGmt('', '2024-01-15T10:30:00')).toBe('2024-01-15T10:30:00Z');
  });

  it('should return epoch sentinel when both fields are empty', () => {
    expect(normGmt('', '')).toBe('1970-01-01T00:00:00.000Z');
  });

  it('should not double-append Z when gmt already has it', () => {
    expect(normGmt('2024-01-15T10:30:00Z', '')).toBe('2024-01-15T10:30:00Z');
  });
});
