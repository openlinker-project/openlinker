/**
 * NBP Exchange-Rate Client — Unit Specs
 *
 * Exercises the weekend/holiday walk-back, the tax-point−1 start rule, response
 * parsing, and failure modes with an INJECTED fake fetch — never the network.
 *
 * @module libs/integrations/ksef/src/infrastructure/fx
 */
import { KsefExchangeRateException } from '../../../domain/exceptions/ksef-exchange-rate.exception';
import { NbpExchangeRateClient } from '../nbp-exchange-rate.client';
import type { NbpFetch, NbpFetchResponse } from '../nbp-exchange-rate.types';

/** A 200 response carrying one NBP table-A rate row. */
function ok(mid: number, effectiveDate: string, no = '047/A/NBP/2026'): NbpFetchResponse {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({ table: 'A', currency: 'euro', code: 'EUR', rates: [{ no, effectiveDate, mid }] }),
  };
}

/** A 404 (non-publication day). */
function notFound(): NbpFetchResponse {
  return { ok: false, status: 404, json: () => Promise.resolve({}) };
}

/** Extract the `YYYY-MM-DD` date segment from a requested NBP URL. */
function dateOf(url: string): string {
  const match = url.match(/\/a\/[a-z]+\/(\d{4}-\d{2}-\d{2})\//);
  if (!match) {
    throw new Error(`unexpected NBP url: ${url}`);
  }
  return match[1];
}

describe('NbpExchangeRateClient', () => {
  it('should query the day before the tax point and return the parsed rate', async () => {
    const seen: string[] = [];
    const fetchImpl: NbpFetch = (url) => {
      seen.push(url);
      return Promise.resolve(ok(4.321, '2026-03-10'));
    };
    const client = new NbpExchangeRateClient({ fetchImpl });

    const result = await client.resolveRate('EUR', '2026-03-11');

    expect(result).toEqual({ rate: 4.321, rateDate: '2026-03-10', table: '047/A/NBP/2026' });
    // Tax point 2026-03-11 → first lookup is the preceding day 2026-03-10.
    expect(dateOf(seen[0])).toBe('2026-03-10');
    expect(seen[0]).toContain('/a/eur/');
    expect(seen[0]).toContain('format=json');
  });

  it('should walk back across a weekend when NBP 404s the non-publication days', async () => {
    // Tax point Monday 2026-03-09 → preceding day Sunday 03-08 (404),
    // Saturday 03-07 (404), Friday 03-06 (published).
    const seen: string[] = [];
    const fetchImpl: NbpFetch = (url) => {
      const date = dateOf(url);
      seen.push(date);
      if (date === '2026-03-06') {
        return Promise.resolve(ok(4.3, '2026-03-06'));
      }
      return Promise.resolve(notFound());
    };
    const client = new NbpExchangeRateClient({ fetchImpl });

    const result = await client.resolveRate('EUR', '2026-03-09');

    expect(result.rate).toBe(4.3);
    expect(result.rateDate).toBe('2026-03-06');
    expect(seen).toEqual(['2026-03-08', '2026-03-07', '2026-03-06']);
  });

  it('should walk back across a multi-day holiday cluster (also 404s, same mechanism)', async () => {
    // Simulate a long holiday gap: only 2025-12-24 is published; 12-25..01-01 404.
    const fetchImpl: NbpFetch = (url) => {
      const date = dateOf(url);
      return Promise.resolve(date === '2025-12-24' ? ok(4.25, '2025-12-24') : notFound());
    };
    const client = new NbpExchangeRateClient({ fetchImpl });

    const result = await client.resolveRate('EUR', '2026-01-02');

    expect(result.rateDate).toBe('2025-12-24');
  });

  it('should throw when no rate is published within the look-back window', async () => {
    const fetchImpl: NbpFetch = () => Promise.resolve(notFound());
    const client = new NbpExchangeRateClient({ fetchImpl, maxLookbackDays: 3 });

    await expect(client.resolveRate('EUR', '2026-03-11')).rejects.toBeInstanceOf(
      KsefExchangeRateException,
    );
  });

  it('should throw on a non-404 HTTP error', async () => {
    const fetchImpl: NbpFetch = () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    const client = new NbpExchangeRateClient({ fetchImpl });

    await expect(client.resolveRate('EUR', '2026-03-11')).rejects.toBeInstanceOf(
      KsefExchangeRateException,
    );
  });

  it('should throw on a network failure from fetch', async () => {
    const fetchImpl: NbpFetch = () => Promise.reject(new Error('ECONNRESET'));
    const client = new NbpExchangeRateClient({ fetchImpl });

    await expect(client.resolveRate('EUR', '2026-03-11')).rejects.toBeInstanceOf(
      KsefExchangeRateException,
    );
  });

  it('should throw on a malformed / non-positive rate payload', async () => {
    const fetchImpl: NbpFetch = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ rates: [{ mid: 0 }] }) });
    const client = new NbpExchangeRateClient({ fetchImpl });

    await expect(client.resolveRate('EUR', '2026-03-11')).rejects.toBeInstanceOf(
      KsefExchangeRateException,
    );
  });

  it('should reject a non-ISO tax point date', async () => {
    const fetchImpl: NbpFetch = () => Promise.resolve(ok(4.3, '2026-03-10'));
    const client = new NbpExchangeRateClient({ fetchImpl });

    await expect(client.resolveRate('EUR', '11/03/2026')).rejects.toBeInstanceOf(
      KsefExchangeRateException,
    );
  });
});
