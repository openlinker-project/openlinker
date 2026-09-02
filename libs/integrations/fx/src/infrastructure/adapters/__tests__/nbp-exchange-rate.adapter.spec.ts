/**
 * NBP Exchange Rate Adapter Tests
 *
 * Every case runs against a faked `FetchLike`. No tier of this suite makes a
 * live NBP call.
 *
 * @module libs/integrations/fx/infrastructure/adapters/__tests__
 */
import {
  RateUnavailableTransientError,
  RateUnsupportedPairError,
} from '@openlinker/core/currency';
import type { FetchLike } from '@openlinker/shared/http';
import { NbpExchangeRateAdapter } from '../nbp-exchange-rate.adapter';

interface StubResponse {
  status: number;
  body: string;
}

/** Requested-URL log plus a per-URL response table. */
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

function nbpBody(mid: number, effectiveDate: string, no = '149/A/NBP/2026'): string {
  return JSON.stringify({
    table: 'A',
    currency: 'euro',
    code: 'EUR',
    rates: [{ no, effectiveDate, mid }],
  });
}

function ok(body: string): StubResponse {
  return { status: 200, body };
}

/** The rate-lookup error a call rejected with, typed for its own fields. */
type RateError = Error & { from: string; to: string; reason: string };

async function rejectionOf(promise: Promise<unknown>): Promise<RateError> {
  try {
    await promise;
  } catch (error) {
    return error as RateError;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('NbpExchangeRateAdapter', () => {
  describe('supports', () => {
    it('should accept a table-A pair', () => {
      const { fetchImpl } = fakeFetch(() => ok(''));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      expect(adapter.supports('EUR', 'PLN')).toBe(true);
      expect(adapter.supports('PLN', 'USD')).toBe(true);
    });

    it('should reject a currency absent from table A', () => {
      // Tables B and C are out of scope, so such a currency 404s on EVERY
      // walk-back day - rejecting it up front is what stops maxAttempts (10)
      // x 7 futile requests.
      const { fetchImpl } = fakeFetch(() => ok(''));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      expect(adapter.supports('XYZ', 'PLN')).toBe(false);
    });

    it('should reject a same-currency pair - no source publishes an identity quote', () => {
      const { fetchImpl } = fakeFetch(() => ok(''));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      expect(adapter.supports('PLN', 'PLN')).toBe(false);
    });

    it('should list PLN alongside the table-A currencies', () => {
      const { fetchImpl } = fakeFetch(() => ok(''));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      expect(adapter.listSupportedCurrencies()).toContain('PLN');
      expect(adapter.listSupportedCurrencies()).toContain('EUR');
    });
  });

  describe('working-day resolution', () => {
    it('should query the candidate day ITSELF when it is already a working day', () => {
      // The trap this pins: `previousWorkingDay` always steps back at least one
      // calendar day, so calling it blindly would skip a perfectly good
      // publication day and stamp yesterday's rate - silently, on a financial
      // figure, with no error anywhere.
      const { fetchImpl, urls } = fakeFetch(() => ok(nbpBody(4.25, '2026-06-10')));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      return adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' }).then((rate) => {
        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain('/eur/2026-06-10/');
        expect(rate.rateDate).toBe('2026-06-10');
      });
    });

    it('should resolve a Sunday candidate to the preceding Friday in ONE request', async () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(nbpBody(4.25, '2026-06-12')));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-14' });

      // Sunday 2026-06-14 -> Friday 2026-06-12, resolved by the calendar rather
      // than by three walk-back round-trips.
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('/eur/2026-06-12/');
      expect(rate.rateDate).toBe('2026-06-12');
    });

    it('should skip a Polish-only public holiday, which is correct for NBP', async () => {
      // Corpus Christi, Thursday 2026-06-04. NBP does not publish; ECB does -
      // which is exactly why the shared rule is calendar-neutral and this
      // knowledge lives in the adapter.
      const { fetchImpl, urls } = fakeFetch(() => ok(nbpBody(4.2383, '2026-06-03')));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-04' });

      expect(urls[0]).toContain('/eur/2026-06-03/');
    });

    it('should persist the effectiveDate the API answered with, not the day requested', async () => {
      const { fetchImpl } = fakeFetch(() => ok(nbpBody(4.25, '2026-06-11')));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-12' });

      expect(rate.rateDate).toBe('2026-06-11');
    });
  });

  describe('resolveLikelyPublicationDay (#2777)', () => {
    it('should return the Friday before a Saturday candidate, with no HTTP call', () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(nbpBody(4.25, '2026-08-14')));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const resolved = adapter.resolveLikelyPublicationDay('2026-08-15');

      expect(resolved).toBe('2026-08-14');
      expect(urls).toHaveLength(0);
    });

    it('should return the candidate itself for an ordinary working day', () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(nbpBody(4.25, '2026-08-13')));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const resolved = adapter.resolveLikelyPublicationDay('2026-08-13');

      expect(resolved).toBe('2026-08-13');
      expect(urls).toHaveLength(0);
    });
  });

  describe('direct resolution (X -> PLN)', () => {
    it('should return the published mid verbatim at 8 decimal places', async () => {
      const { fetchImpl } = fakeFetch(() => ok(nbpBody(4.25, '2026-06-10')));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' });

      expect(rate).toMatchObject({
        source: 'nbp',
        from: 'EUR',
        to: 'PLN',
        rate: '4.25000000',
        rateDate: '2026-06-10',
        sourceRef: '149/A/NBP/2026',
        pivotCurrency: null,
      });
      expect(rate.derivation).toEqual({
        kind: 'direct',
        legs: [{ pair: 'EUR/PLN', ref: '149/A/NBP/2026', effectiveDate: '2026-06-10' }],
      });
    });

    it('should record a derivation even for a direct rate', () => {
      // NOT NULL by design: a consumer never has to guess whether an empty
      // column means "direct" or "unknown".
      const { fetchImpl } = fakeFetch(() => ok(nbpBody(4.25, '2026-06-10')));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      return adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' }).then((rate) => {
        expect(rate.derivation.kind).toBe('direct');
        expect(rate.derivation.legs).toHaveLength(1);
      });
    });
  });

  describe('inverted resolution (PLN -> X)', () => {
    it('should invert the published mid', async () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(nbpBody(4.25, '2026-06-10')));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'PLN', to: 'EUR', on: '2026-06-10' });

      // 1 / 4.25 = 0.23529412 (8 dp). Multiplying a PLN total by it yields EUR.
      expect(rate.rate).toBe('0.23529412');
      expect(rate.derivation.kind).toBe('inverted');
      expect(rate.pivotCurrency).toBeNull();
      // The leg still names the PUBLISHED pair, not the derived one.
      expect(rate.derivation.legs[0].pair).toBe('EUR/PLN');
      expect(urls[0]).toContain('/eur/');
    });
  });

  describe('pivot resolution (X -> Y)', () => {
    it('should divide the two mids through PLN with an exact expected value', async () => {
      const { fetchImpl } = fakeFetch((url) =>
        url.includes('/eur/')
          ? ok(nbpBody(4.25, '2026-06-10'))
          : ok(nbpBody(3.9, '2026-06-10', '149/A/NBP/2026'))
      );
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'USD', on: '2026-06-10' });

      // 4.2500 / 3.9000 = 1.08974359. Sanity: EUR is worth more than USD, so
      // the result must exceed 1 - a flipped divide gives 0.917..., the tell.
      expect(rate.rate).toBe('1.08974359');
      expect(rate.pivotCurrency).toBe('PLN');
      expect(rate.derivation.kind).toBe('pivot');
      expect(rate.derivation.legs).toEqual([
        { pair: 'EUR/PLN', ref: '149/A/NBP/2026', effectiveDate: '2026-06-10' },
        { pair: 'USD/PLN', ref: '149/A/NBP/2026', effectiveDate: '2026-06-10' },
      ]);
    });

    it('should raise when the two legs resolve to different effective dates', async () => {
      // Combining two dates into a single rateDate would make the stored row
      // unverifiable against any published table.
      const { fetchImpl } = fakeFetch((url) =>
        url.includes('/eur/')
          ? ok(nbpBody(4.25, '2026-06-10'))
          : ok(nbpBody(3.9, '2026-06-09'))
      );
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'USD', on: '2026-06-10' })
      ).rejects.toThrow(RateUnsupportedPairError);
    });

    it('should join distinct leg refs rather than dropping one', async () => {
      const { fetchImpl } = fakeFetch((url) =>
        url.includes('/eur/')
          ? ok(nbpBody(4.25, '2026-06-10', '149/A/NBP/2026'))
          : ok(nbpBody(3.9, '2026-06-10', '150/A/NBP/2026'))
      );
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'USD', on: '2026-06-10' });

      expect(rate.sourceRef).toBe('149/A/NBP/2026 + 150/A/NBP/2026');
    });
  });

  describe('walk-back on an unexpected non-publication day', () => {
    it('should step back on a 404 and use the day it finds', async () => {
      const { fetchImpl, urls } = fakeFetch((url) =>
        url.includes('2026-06-10')
          ? { status: 404, body: '404 NotFound - Not Found - Brak danych' }
          : ok(nbpBody(4.24, '2026-06-09'))
      );
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const rate = await adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' });

      expect(urls).toHaveLength(2);
      expect(rate.rateDate).toBe('2026-06-09');
    });

    it('should raise a terminal RateUnsupportedPairError when the walk-back is exhausted', async () => {
      const { fetchImpl, urls } = fakeFetch(() => ({ status: 404, body: 'Not Found' }));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' })
      ).rejects.toThrow(RateUnsupportedPairError);
      // Bounded, so a dead source cannot turn one order into an unbounded
      // request storm.
      expect(urls.length).toBeLessThanOrEqual(8);
    });
  });

  describe('failure classification', () => {
    it('should treat ANY non-404 4xx as terminal', async () => {
      // Deliberately not hardcoded to 400: NBP's malformed-date response is
      // documented but unverified, so the whole class is terminal - correct
      // whichever code it actually returns, and it closes the hole where a 400
      // escapes a 404-only walk-back as an unhandled HTTP error.
      const { fetchImpl } = fakeFetch(() => ({ status: 400, body: 'Bad Request' }));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' })
      ).rejects.toThrow(RateUnsupportedPairError);
    });

    it.each([429, 408])(
      'should treat %i as TRANSIENT even though it is a 4xx',
      async (status: number) => {
        // #2135 review, finding 1. NBP is public and unauthenticated, so 429 is
        // what a burst earns - and the sweep's sequential page walk can produce
        // one unaided. Classified terminal it would write the row's permanent
        // `fxStampedAt` marker, costing those orders their reported figure for a
        // throttle that clears in seconds. 408 is a server-side read timeout, the
        // same class of event as the local abort two cases below.
        const { fetchImpl } = fakeFetch(() => ({ status, body: '' }));
        const adapter = new NbpExchangeRateAdapter({ fetchImpl });

        await expect(
          adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' })
        ).rejects.toThrow(RateUnavailableTransientError);
      }
    );

    it('should treat a 5xx as transient', async () => {
      const { fetchImpl } = fakeFetch(() => ({ status: 503, body: 'Service Unavailable' }));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' })
      ).rejects.toThrow(RateUnavailableTransientError);
    });

    it('should treat a network failure as transient', async () => {
      const { fetchImpl } = fakeFetch(() => new Error('ECONNRESET'));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' })
      ).rejects.toThrow(RateUnavailableTransientError);
    });

    it('should treat a timeout as transient', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const { fetchImpl } = fakeFetch(() => abortError);
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' })
      ).rejects.toThrow(RateUnavailableTransientError);
    });

    it('should reject an unsupported pair before making any request', async () => {
      const { fetchImpl, urls } = fakeFetch(() => ok(''));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'XYZ', to: 'PLN', on: '2026-06-10' })
      ).rejects.toThrow(RateUnsupportedPairError);
      expect(urls).toHaveLength(0);
    });

    it('should raise terminally on an unparseable 200 body rather than storing junk', async () => {
      const { fetchImpl } = fakeFetch(() => ok('<html>maintenance</html>'));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' })
      ).rejects.toThrow(RateUnsupportedPairError);
    });

    it('should raise terminally on a 200 with an empty rates array', async () => {
      const { fetchImpl } = fakeFetch(() => ok(JSON.stringify({ table: 'A', rates: [] })));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      await expect(
        adapter.fetchRate({ from: 'EUR', to: 'PLN', on: '2026-06-10' })
      ).rejects.toThrow(RateUnsupportedPairError);
    });
  });

  describe('errors name the REQUESTED pair, never the leg', () => {
    // `PLN -> EUR` fetches the single `EUR` leg, so an error built from the leg
    // currencies renders as `EUR/EUR` - a pair the operator never asked for. A
    // terminal RateUnsupportedPairError is a business_failure with no retry
    // (ADR-007), so this log line is the only signal they get.
    it('should name PLN/EUR when the walk-back is exhausted on an inverted request', async () => {
      const { fetchImpl } = fakeFetch(() => ({ status: 404, body: 'Not Found' }));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const error = await rejectionOf(
        adapter.fetchRate({ from: 'PLN', to: 'EUR', on: '2026-06-10' })
      );

      expect(error).toBeInstanceOf(RateUnsupportedPairError);
      expect(error.from).toBe('PLN');
      expect(error.to).toBe('EUR');
      expect(error.message).toContain('Exchange rate PLN/EUR on 2026-06-10');
    });

    it('should name PLN/EUR when a leg answers 5xx on an inverted request', async () => {
      // The pre-fix code hardcoded `to` to the pivot, so a PLN -> EUR blip
      // logged as EUR/PLN - the inverse of the requested direction.
      const { fetchImpl } = fakeFetch(() => ({ status: 503, body: 'Service Unavailable' }));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const error = await rejectionOf(
        adapter.fetchRate({ from: 'PLN', to: 'EUR', on: '2026-06-10' })
      );

      expect(error).toBeInstanceOf(RateUnavailableTransientError);
      expect(error.from).toBe('PLN');
      expect(error.to).toBe('EUR');
      expect(error.message).toContain('Exchange rate PLN/EUR on 2026-06-10');
      // The leg and the day survive as diagnostic detail in the reason.
      expect(error.reason).toContain('EUR on 2026-06-10');
    });

    it('should name the requested pair on a transport failure, not the leg', async () => {
      const { fetchImpl } = fakeFetch(() => new Error('ECONNRESET'));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const error = await rejectionOf(
        adapter.fetchRate({ from: 'PLN', to: 'EUR', on: '2026-06-10' })
      );

      expect(error.from).toBe('PLN');
      expect(error.to).toBe('EUR');
    });

    it('should name the requested pair on a non-404 4xx, not the leg', async () => {
      const { fetchImpl } = fakeFetch(() => ({ status: 400, body: 'Bad Request' }));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const error = await rejectionOf(
        adapter.fetchRate({ from: 'PLN', to: 'EUR', on: '2026-06-10' })
      );

      expect(error.from).toBe('PLN');
      expect(error.to).toBe('EUR');
      expect(error.reason).toContain('EUR on 2026-06-10');
    });

    it('should name the requested pair on an unparseable body, not the leg', async () => {
      const { fetchImpl } = fakeFetch(() => ok('<html>maintenance</html>'));
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const error = await rejectionOf(
        adapter.fetchRate({ from: 'PLN', to: 'EUR', on: '2026-06-10' })
      );

      expect(error.from).toBe('PLN');
      expect(error.to).toBe('EUR');
    });

    it('should name the requested pair on a pivot leg failure', async () => {
      // EUR -> USD walks two legs; reporting the leg pair would render the
      // second leg's failure as `USD/PLN`.
      const { fetchImpl } = fakeFetch((url) =>
        url.includes('/eur/') ? ok(nbpBody(4.25, '2026-06-10')) : { status: 503, body: '' }
      );
      const adapter = new NbpExchangeRateAdapter({ fetchImpl });

      const error = await rejectionOf(
        adapter.fetchRate({ from: 'EUR', to: 'USD', on: '2026-06-10' })
      );

      expect(error.from).toBe('EUR');
      expect(error.to).toBe('USD');
    });
  });
});
