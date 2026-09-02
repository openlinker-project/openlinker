/**
 * ECB Exchange Rate Adapter Tests
 *
 * Every case runs against a faked `FetchLike`. No tier of this suite makes a
 * live ECB call.
 *
 * @module libs/integrations/fx/infrastructure/adapters/__tests__
 */
import {
  RateUnavailableTransientError,
  RateUnsupportedPairError,
} from '@openlinker/core/currency';
import type { FetchLike } from '@openlinker/shared/http';
import { Logger } from '@openlinker/shared/logging';
import { EcbExchangeRateAdapter } from '../ecb-exchange-rate.adapter';

interface StubResponse {
  status: number;
  body: string;
}

function fakeFetch(responder: (url: string) => StubResponse | Error): {
  fetchImpl: FetchLike;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = ((input: unknown) => {
    const url = String(input);
    urls.push(url);
    const result = responder(url);
    if (result instanceof Error) {
      return Promise.reject(result);
    }
    return Promise.resolve({
      status: result.status,
      text: () => Promise.resolve(result.body),
    } as unknown as Response);
  }) as unknown as FetchLike;

  return { fetchImpl, urls };
}

/** An SDMX `csvdata` + `detail=dataonly` response - eight columns, one row. */
function csv(currency: string, timePeriod: string, value: string): string {
  return [
    'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE',
    `EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${timePeriod},${value}`,
  ].join('\n');
}

function ok(body: string): StubResponse {
  return { status: 200, body };
}

describe('EcbExchangeRateAdapter', () => {
  describe('supports', () => {
    it('should accept a daily-reference pair', () => {
      const { fetchImpl } = fakeFetch(() => ok(''));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      expect(adapter.supports('EUR', 'PLN')).toBe(true);
      expect(adapter.supports('PLN', 'EUR')).toBe(true);
    });

    it('should reject a currency outside the daily reference set', () => {
      const { fetchImpl } = fakeFetch(() => ok(''));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      expect(adapter.supports('XYZ', 'EUR')).toBe(false);
    });

    it('should reject EUR/EUR - there is no identity series', () => {
      const { fetchImpl } = fakeFetch(() => ok(''));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      expect(adapter.supports('EUR', 'EUR')).toBe(false);
    });
  });

  describe('request shape', () => {
    it('should read endPeriod + lastNObservations=1 in csvdata/dataonly form', async () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(csv('PLN', '2026-08-13', '4.2712')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' });

      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('/EXR/D.PLN.EUR.SP00.A');
      expect(urls[0]).toContain('endPeriod=2026-08-13');
      expect(urls[0]).toContain('lastNObservations=1');
      expect(urls[0]).toContain('format=csvdata');
      expect(urls[0]).toContain('detail=dataonly');
    });

    it('should NEVER set includeHistory', async () => {
      // includeHistory + lastNObservations=1 injects a phantom row carrying
      // ACTION=Delete, an empty OBS_VALUE and an unrelated historical
      // TIME_PERIOD (a 2015 date observed on a 2026 query) - so an adapter
      // reading "the last row" gets an empty rate and a nonsense date.
      const { fetchImpl, urls } = fakeFetch(() => ok(csv('PLN', '2026-08-13', '4.2712')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' });

      expect(urls[0]).not.toContain('includeHistory');
    });
  });

  describe('server-side day resolution - no walk-back loop', () => {
    it('should resolve a Saturday endPeriod to the preceding Friday in ONE request', async () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(csv('PLN', '2026-08-07', '4.2680')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-08' });

      expect(urls).toHaveLength(1);
      expect(rate.rateDate).toBe('2026-08-07');
    });

    it('should resolve the Easter cluster to the last publication before it', async () => {
      // Good Friday 2026-04-03 and Easter Monday 2026-04-06 both resolve to
      // 2026-04-02 - a cluster a walk-back-by-one gets wrong.
      const { fetchImpl, urls } = fakeFetch(() => ok(csv('PLN', '2026-04-02', '4.2401')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-04-06' });

      expect(urls).toHaveLength(1);
      expect(rate.rateDate).toBe('2026-04-02');
    });

    it('should resolve across the year boundary', async () => {
      const { fetchImpl } = fakeFetch(() => ok(csv('PLN', '2025-12-31', '4.2600')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-01-01' });

      expect(rate.rateDate).toBe('2025-12-31');
    });

    it('should publish on a Polish-only holiday, which the Polish calendar would have skipped', async () => {
      // Corpus Christi, Thursday 2026-06-04: ECB publishes 4.2368. A shared
      // Polish calendar would have asked for 2026-06-03 and stamped 4.2383 -
      // off by 0.0015 PLN per EUR, silently, on every Polish-only holiday.
      const { fetchImpl, urls } = fakeFetch(() => ok(csv('PLN', '2026-06-04', '4.2368')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-04' });

      expect(urls[0]).toContain('endPeriod=2026-06-04');
      expect(rate.rate).toBe('4.23680000');
    });
  });

  describe('resolveLikelyPublicationDay (#2777)', () => {
    it('should return the Friday before a Saturday candidate, with no HTTP call', () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(csv('PLN', '2026-08-14', '4.2680')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const resolved = adapter.resolveLikelyPublicationDay('2026-08-15');

      expect(resolved).toBe('2026-08-14');
      expect(urls).toHaveLength(0);
    });

    it('should return the Corpus Christi date ITSELF, proving no Polish-calendar dependency', () => {
      // Thursday 2026-06-04, a genuine Polish public holiday. A Polish-calendar
      // walk-back would resolve this to 2026-06-03 - exactly the bug the class
      // header's "server-side day resolution" tests above pin against for
      // `fetchRate`. This method must make the same non-decision.
      const { fetchImpl, urls } = fakeFetch(() => ok(csv('PLN', '2026-06-04', '4.2368')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const resolved = adapter.resolveLikelyPublicationDay('2026-06-04');

      expect(resolved).toBe('2026-06-04');
      expect(urls).toHaveLength(0);
    });

    it('should return the candidate itself for an ordinary weekday', () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(csv('PLN', '2026-08-13', '4.2680')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const resolved = adapter.resolveLikelyPublicationDay('2026-08-13');

      expect(resolved).toBe('2026-08-13');
      expect(urls).toHaveLength(0);
    });
  });

  describe('direct resolution (EUR -> X)', () => {
    it('should return the observation verbatim at 8 decimal places', async () => {
      const { fetchImpl } = fakeFetch(() => ok(csv('PLN', '2026-08-13', '4.2712')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' });

      expect(rate).toMatchObject({
        source: 'ecb',
        from: 'EUR',
        to: 'PLN',
        rate: '4.27120000',
        rateDate: '2026-08-13',
        pivotCurrency: null,
      });
      expect(rate.derivation).toEqual({
        kind: 'direct',
        legs: [
          {
            pair: 'EUR/PLN',
            ref: 'ECB:EXR(1.0):D.PLN.EUR.SP00.A@2026-08-13',
            effectiveDate: '2026-08-13',
          },
        ],
      });
    });

    it('should persist an OL-constructed, re-executable locator as sourceRef', async () => {
      // ECB assigns no document identifier: header.id is a fresh random UUID
      // per request and Last-Modified is not data-dependent. So this is
      // OpenLinker's construction, not an ECB-assigned reference - stated,
      // not papered over.
      const { fetchImpl } = fakeFetch(() => ok(csv('PLN', '2026-08-13', '4.2712')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' });

      expect(rate.sourceRef).toBe('ECB:EXR(1.0):D.PLN.EUR.SP00.A@2026-08-13');
    });

    it('should parse a 2-decimal quote without loss', async () => {
      // Decimal places vary per currency, unlike NBP's fixed 4: JPY and HUF
      // publish 2, GBP 5.
      const { fetchImpl } = fakeFetch(() => ok(csv('JPY', '2026-08-13', '171.35')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'JPY', on: '2026-08-13' });

      expect(rate.rate).toBe('171.35000000');
    });

    it('should index CSV columns by header name, not by position', async () => {
      // Positional indexing would silently read the wrong column the day ECB
      // reorders or adds one.
      const reordered = [
        'OBS_VALUE,TIME_PERIOD,KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX',
        '4.2712,2026-08-13,EXR.D.PLN.EUR.SP00.A,D,PLN,EUR,SP00,A',
      ].join('\n');
      const { fetchImpl } = fakeFetch(() => ok(reordered));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' });

      expect(rate.rate).toBe('4.27120000');
      expect(rate.rateDate).toBe('2026-08-13');
    });
  });

  describe('inverted resolution (X -> EUR)', () => {
    it('should invert the observation', async () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(csv('PLN', '2026-08-13', '4.0000')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'PLN', to: 'EUR', on: '2026-08-13' });

      expect(rate.rate).toBe('0.25000000');
      expect(rate.derivation.kind).toBe('inverted');
      expect(rate.pivotCurrency).toBeNull();
      // The leg names the PUBLISHED pair, EUR/PLN, not the derived PLN/EUR.
      expect(rate.derivation.legs[0].pair).toBe('EUR/PLN');
      expect(urls[0]).toContain('D.PLN.EUR.SP00.A');
    });
  });

  describe('pivot resolution (X -> Y)', () => {
    it('should divide the two observations through EUR', async () => {
      const { fetchImpl } = fakeFetch((url) =>
        url.includes('D.PLN.')
          ? ok(csv('PLN', '2026-08-13', '4.0000'))
          : ok(csv('USD', '2026-08-13', '1.1600'))
      );
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'PLN', to: 'USD', on: '2026-08-13' });

      // 1 PLN = (1/4.0000) EUR = 1.1600/4.0000 USD = 0.29 USD.
      expect(rate.rate).toBe('0.29000000');
      expect(rate.pivotCurrency).toBe('EUR');
      expect(rate.derivation.kind).toBe('pivot');
      expect(rate.derivation.legs.map((leg) => leg.pair)).toEqual(['EUR/PLN', 'EUR/USD']);
    });

    it('should raise when the two legs resolve to different observation dates', async () => {
      const { fetchImpl } = fakeFetch((url) =>
        url.includes('D.PLN.')
          ? ok(csv('PLN', '2026-08-13', '4.0000'))
          : ok(csv('USD', '2026-08-12', '1.1600'))
      );
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'PLN', to: 'USD', on: '2026-08-13' })
      ).rejects.toThrow(RateUnsupportedPairError);
    });

    describe('mixed-failure classification', () => {
      // With `Promise.all` the winning rejection is whichever settles FIRST, so
      // a 404 on one leg and a 503 on the other classified by network timing -
      // deciding between "die now" and "retry ten times" by a race. Terminal
      // wins, in both orderings.
      it('should report the TERMINAL leg when the from-leg 404s and the to-leg 503s', async () => {
        const { fetchImpl } = fakeFetch((url) =>
          url.includes('D.PLN.')
            ? { status: 404, body: JSON.stringify({ title: 'Not Found', status: 404 }) }
            : { status: 503, body: '' }
        );
        const adapter = new EcbExchangeRateAdapter({ fetchImpl });

        await expect(
          adapter.fetchRate({ from: 'PLN', to: 'USD', on: '2026-08-13' })
        ).rejects.toThrow(RateUnsupportedPairError);
      });

      it('should report the TERMINAL leg when the to-leg 404s and the from-leg 503s', async () => {
        const { fetchImpl } = fakeFetch((url) =>
          url.includes('D.USD.')
            ? { status: 404, body: JSON.stringify({ title: 'Not Found', status: 404 }) }
            : { status: 503, body: '' }
        );
        const adapter = new EcbExchangeRateAdapter({ fetchImpl });

        await expect(
          adapter.fetchRate({ from: 'PLN', to: 'USD', on: '2026-08-13' })
        ).rejects.toThrow(RateUnsupportedPairError);
      });

      it('should still report transient when BOTH legs are transient', async () => {
        const { fetchImpl } = fakeFetch(() => ({ status: 503, body: '' }));
        const adapter = new EcbExchangeRateAdapter({ fetchImpl });

        await expect(
          adapter.fetchRate({ from: 'PLN', to: 'USD', on: '2026-08-13' })
        ).rejects.toThrow(RateUnavailableTransientError);
      });
    });
  });

  describe('failure classification', () => {
    it('should treat a 200 with a ZERO-BYTE body as terminal, distinctly from a 404', async () => {
      // The opposite of NBP's shape. An adapter written on the NBP shape would
      // treat this as success-with-no-data and hand an empty string to its
      // parser; the body is length-checked BEFORE any parsing.
      const { fetchImpl } = fakeFetch(() => ok(''));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(/no observation for/);
    });

    it('should treat a 404 as an unsupported PAIR, with its own reason', async () => {
      const { fetchImpl } = fakeFetch(() => ({
        status: 404,
        body: JSON.stringify({
          title: 'Not Found',
          status: 404,
          detail: 'No Series was returned for the query.',
        }),
      }));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(/has no series/);
    });

    it('should treat an HTML-bodied 400 as terminal without parsing the body', async () => {
      // A malformed date returns 400 with a ~12 KB HTML error page, while 404
      // and 406 return application/problem+json. An unconditional JSON.parse
      // would replace the terminal error with a SyntaxError.
      const html = `<!DOCTYPE html><html><head><title>Error</title></head><body>${'x'.repeat(2000)}</body></html>`;
      const { fetchImpl } = fakeFetch(() => ({ status: 400, body: html }));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(RateUnsupportedPairError);
    });

    it('should treat a 406 as terminal - an unsupported Accept header is our bug', async () => {
      const { fetchImpl } = fakeFetch(() => ({
        status: 406,
        body: JSON.stringify({ title: 'Not Acceptable', status: 406 }),
      }));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(RateUnsupportedPairError);
    });

    it.each([429, 408])(
      'should treat %i as TRANSIENT even though it is a 4xx',
      async (status: number) => {
        // #2135 review, finding 1 - same reasoning as the NBP adapter: the ECB
        // SDMX API is public and unauthenticated too, and a wrongly-terminal
        // throttle permanently marks the order answered without a figure.
        const { fetchImpl } = fakeFetch(() => ({ status, body: '' }));
        const adapter = new EcbExchangeRateAdapter({ fetchImpl });

        await expect(
          adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
        ).rejects.toThrow(RateUnavailableTransientError);
      }
    );

    it('should treat a 5xx as transient', async () => {
      const { fetchImpl } = fakeFetch(() => ({ status: 503, body: '' }));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(RateUnavailableTransientError);
    });

    it('should treat a network failure as transient', async () => {
      const { fetchImpl } = fakeFetch(() => new Error('ENOTFOUND'));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(RateUnavailableTransientError);
    });

    it('should treat a timeout as transient', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const { fetchImpl } = fakeFetch(() => abortError);
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(RateUnavailableTransientError);
    });

    it('should reject an unsupported pair before making any request', async () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(''));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'XYZ', to: 'EUR', on: '2026-08-13' })
      ).rejects.toThrow(RateUnsupportedPairError);
      expect(urls).toHaveLength(0);
    });
  });

  describe('stale-observation backstop', () => {
    it('should refuse an observation more than 10 days before the requested day', async () => {
      // The real maximum non-publication run is 4 calendar days, so this can
      // only fire on a clamp regression - a future endPeriod silently returns a
      // months-stale rate at HTTP 200 with no signal of any kind.
      const { fetchImpl } = fakeFetch(() => ok(csv('PLN', '2026-08-13', '4.2712')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-12-24' })
      ).rejects.toThrow(/more than 10 days before/);
    });

    // The bound is `> MAX_OBSERVATION_LAG_DAYS`, so 10 is accepted and 11 is
    // refused. Pinned on both sides because an off-by-one here either lets a
    // stale rate through onto a financial figure or rejects a legitimate one.
    it.each<[number, string, 'accept' | 'refuse']>([
      [10, '2026-08-03', 'accept'],
      [11, '2026-08-02', 'refuse'],
    ])(
      'should treat a %i-day lag (observation %s) as %s',
      async (_lagDays, timePeriod, verdict) => {
        const { fetchImpl } = fakeFetch(() => ok(csv('PLN', timePeriod, '4.2712')));
        const adapter = new EcbExchangeRateAdapter({ fetchImpl });

        const call = adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' });

        if (verdict === 'accept') {
          await expect(call).resolves.toMatchObject({ rateDate: timePeriod });
        } else {
          await expect(call).rejects.toThrow(/more than 10 days before/);
        }
      }
    );

    // #2135 review, finding 6. Between "legal" (the real maximum run is 4 days)
    // and the hard bound of 10 sits a band that is also what a source that has
    // stopped publishing looks like. Accepting it silently is the failure; the
    // warn is the whole remedy, so it is asserted on both sides of the threshold.
    it.each<[number, string, boolean]>([
      [3, '2026-08-10', false],
      [4, '2026-08-09', true],
      [6, '2026-08-07', true],
    ])(
      'should warn on a %i-day lag (observation %s): %s',
      async (_lagDays, timePeriod, shouldWarn) => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        try {
          const { fetchImpl } = fakeFetch(() => ok(csv('PLN', timePeriod, '4.2712')));
          const adapter = new EcbExchangeRateAdapter({ fetchImpl });

          // Accepted either way - the warn never refuses a legitimate rate.
          await expect(
            adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
          ).resolves.toMatchObject({ rateDate: timePeriod });

          const warned = warn.mock.calls.some((call) =>
            String(call[0]).includes('days older than the requested')
          );
          expect(warned).toBe(shouldWarn);
        } finally {
          warn.mockRestore();
        }
      }
    );

    it('should accept the longest real non-publication run (4 days)', async () => {
      const { fetchImpl } = fakeFetch(() => ok(csv('PLN', '2026-04-02', '4.2401')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-04-06' })
      ).resolves.toMatchObject({ rateDate: '2026-04-02' });
    });

    it('should refuse an observation dated after the requested day', async () => {
      const { fetchImpl } = fakeFetch(() => ok(csv('PLN', '2026-08-14', '4.2712')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(/after the requested/);
    });
  });

  describe('malformed responses', () => {
    it('should raise terminally on a header-only body', async () => {
      const { fetchImpl } = fakeFetch(() =>
        ok('KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE')
      );
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(/unreadable observation/);
    });

    it('should raise terminally on an empty OBS_VALUE - the phantom-row shape', async () => {
      const { fetchImpl } = fakeFetch(() => ok(csv('PLN', '2026-08-13', '')));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(/unreadable observation/);
    });

    it('should raise terminally when the expected columns are absent', async () => {
      const { fetchImpl } = fakeFetch(() => ok('A,B,C\n1,2,3'));
      const adapter = new EcbExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-08-13' })
      ).rejects.toThrow(/unreadable observation/);
    });
  });
});
