/**
 * NBP Exchange-Rate Client — Unit Specs
 *
 * Exercises the one-request range read ending the day before the tax point,
 * the table-A then table-B fallback (DEF-27), response parsing, and failure
 * modes (DEF-36) with an INJECTED fake fetch — never the network.
 *
 * @module libs/integrations/ksef/src/infrastructure/fx
 */
import { KsefExchangeRateException } from '../../../domain/exceptions/ksef-exchange-rate.exception';
import { NbpExchangeRateClient } from '../nbp-exchange-rate.client';
import type { NbpFetch, NbpFetchResponse } from '../nbp-exchange-rate.types';

interface Row {
  mid: number;
  effectiveDate: string;
  no?: string;
}

/** A 200 response carrying the given NBP rate rows. */
function ok(rows: Row[]): NbpFetchResponse {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        code: 'EUR',
        rates: rows.map((r) => ({ no: r.no ?? '047/A/NBP/2026', effectiveDate: r.effectiveDate, mid: r.mid })),
      }),
  };
}

/** A 404 (the table has nothing for this currency in the window). */
function notFound(): NbpFetchResponse {
  return { ok: false, status: 404, json: () => Promise.resolve({}) };
}

interface RangeRequest {
  table: string;
  code: string;
  start: string;
  end: string;
}

/** Parse `/{table}/{code}/{start}/{end}/` out of a requested NBP URL. */
function rangeOf(url: string): RangeRequest {
  const match = url.match(/\/rates\/([ab])\/([a-z]+)\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})\//);
  if (!match) {
    throw new Error(`unexpected NBP url: ${url}`);
  }
  return { table: match[1], code: match[2], start: match[3], end: match[4] };
}

describe('NbpExchangeRateClient', () => {
  it('should read one table-A range ending the day before the tax point and take its last row', async () => {
    const seen: RangeRequest[] = [];
    const fetchImpl: NbpFetch = (url) => {
      seen.push(rangeOf(url));
      return Promise.resolve(
        ok([
          { mid: 4.3, effectiveDate: '2026-03-09' },
          { mid: 4.321, effectiveDate: '2026-03-10' },
        ]),
      );
    };
    const client = new NbpExchangeRateClient({ fetchImpl });

    const result = await client.resolveRate('EUR', '2026-03-11');

    expect(result).toEqual({ rate: 4.321, rateDate: '2026-03-10', table: '047/A/NBP/2026' });
    expect(seen).toEqual([{ table: 'a', code: 'eur', start: '2026-02-25', end: '2026-03-10' }]);
  });

  it('should take the last publication before a weekend without a calendar', async () => {
    // Tax point Monday 2026-03-09: the range ends Sunday 03-08 and NBP's last
    // row in it is Friday 03-06.
    const fetchImpl: NbpFetch = () =>
      Promise.resolve(
        ok([
          { mid: 4.29, effectiveDate: '2026-03-05' },
          { mid: 4.3, effectiveDate: '2026-03-06' },
        ]),
      );
    const client = new NbpExchangeRateClient({ fetchImpl });

    const result = await client.resolveRate('EUR', '2026-03-09');

    expect(result.rateDate).toBe('2026-03-06');
    expect(result.rate).toBe(4.3);
  });

  it('should not rely on row order and should ignore a row past the range end', async () => {
    const fetchImpl: NbpFetch = () =>
      Promise.resolve(
        ok([
          { mid: 9.99, effectiveDate: '2026-03-11' },
          { mid: 4.25, effectiveDate: '2026-03-10' },
          { mid: 4.2, effectiveDate: '2026-03-02' },
        ]),
      );
    const client = new NbpExchangeRateClient({ fetchImpl });

    const result = await client.resolveRate('EUR', '2026-03-11');

    expect(result.rateDate).toBe('2026-03-10');
  });

  it('should fall back to table B when table A carries no rate for the currency (DEF-27)', async () => {
    const seen: RangeRequest[] = [];
    const fetchImpl: NbpFetch = (url) => {
      const range = rangeOf(url);
      seen.push(range);
      if (range.table === 'a') {
        return Promise.resolve(notFound());
      }
      return Promise.resolve(ok([{ mid: 0.0123, effectiveDate: '2026-03-04', no: '010/B/NBP/2026' }]));
    };
    const client = new NbpExchangeRateClient({ fetchImpl });

    const result = await client.resolveRate('AFN', '2026-03-11');

    expect(result).toEqual({ rate: 0.0123, rateDate: '2026-03-04', table: '010/B/NBP/2026' });
    expect(seen.map((r) => r.table)).toEqual(['a', 'b']);
    // Table B is weekly, so its window is wider than table A's.
    expect(seen[1].start < seen[0].start).toBe(true);
  });

  it('should throw a deterministic error when neither table publishes the currency', async () => {
    const fetchImpl: NbpFetch = () => Promise.resolve(notFound());
    const client = new NbpExchangeRateClient({ fetchImpl });

    const error = await client.resolveRate('XYZ', '2026-03-11').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KsefExchangeRateException);
    expect((error as KsefExchangeRateException).deterministic).toBe(true);
  });

  it('should throw a retryable error on a non-404 HTTP error', async () => {
    const fetchImpl: NbpFetch = () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    const client = new NbpExchangeRateClient({ fetchImpl });

    const error = await client.resolveRate('EUR', '2026-03-11').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KsefExchangeRateException);
    expect((error as KsefExchangeRateException).deterministic).toBe(false);
  });

  it('should throw a retryable error on a network failure from fetch', async () => {
    const fetchImpl: NbpFetch = () => Promise.reject(new Error('ECONNRESET'));
    const client = new NbpExchangeRateClient({ fetchImpl });

    const error = await client.resolveRate('EUR', '2026-03-11').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KsefExchangeRateException);
    expect((error as KsefExchangeRateException).deterministic).toBe(false);
  });

  it('should wrap a 200 that is not JSON instead of leaking a SyntaxError (DEF-36)', async () => {
    const fetchImpl: NbpFetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      });
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

  it('should reject a non-ISO tax point date as deterministic', async () => {
    const fetchImpl: NbpFetch = () => Promise.resolve(ok([{ mid: 4.3, effectiveDate: '2026-03-10' }]));
    const client = new NbpExchangeRateClient({ fetchImpl });

    const error = await client.resolveRate('EUR', '11/03/2026').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KsefExchangeRateException);
    expect((error as KsefExchangeRateException).deterministic).toBe(true);
  });

  it('should mark every refusal as rejected, since no KSeF session was opened yet', async () => {
    const fetchImpl: NbpFetch = () => Promise.reject(new Error('ECONNRESET'));
    const client = new NbpExchangeRateClient({ fetchImpl });

    const error = await client.resolveRate('EUR', '2026-03-11').catch((e: unknown) => e);

    expect((error as KsefExchangeRateException).failureMode).toBe('rejected');
  });
});
