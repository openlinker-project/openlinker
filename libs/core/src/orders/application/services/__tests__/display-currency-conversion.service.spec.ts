/**
 * Display Currency Conversion Service Spec (#2458, ADR-064, #2778)
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { RateUnsupportedPairError } from '@openlinker/core/currency';
import type { ICurrencyRateService, StoredExchangeRate } from '@openlinker/core/currency';
import { MIXED_NATIVE_CURRENCIES_LABEL } from '../../../domain/types/display-currency.types';
import { DisplayCurrencyConversionService } from '../display-currency-conversion.service';

// A fixed instant well clear of any provider-calendar edge case — the exact
// candidate day this resolves to is irrelevant to these tests, which only
// assert on `from`/`to` and call counts, never on the date string itself.
const NOW = new Date('2026-06-10T09:00:00.000Z');

/** A well-formed stored rate, overridable per test. */
function storedRate(overrides: Partial<StoredExchangeRate> = {}): StoredExchangeRate {
  return {
    id: 'rate_1',
    source: 'nbp',
    from: 'PLN',
    to: 'EUR',
    rateDate: '2026-06-09',
    rate: '0.25',
    sourceRef: '149/A/NBP/2026',
    pivotCurrency: null,
    derivation: { kind: 'direct', legs: [] },
    fetchedAt: new Date('2026-06-09T12:00:00.000Z'),
    ...overrides,
  };
}

describe('DisplayCurrencyConversionService', () => {
  let rates: jest.Mocked<ICurrencyRateService>;
  let service: DisplayCurrencyConversionService;

  beforeEach(() => {
    rates = {
      getRateFor: jest.fn(),
    } as unknown as jest.Mocked<ICurrencyRateService>;

    service = new DisplayCurrencyConversionService(rates);
  });

  describe('convertAtCurrentRate', () => {
    it('should exclude an unresolvable native currency from the converted total and report it', async () => {
      rates.getRateFor.mockImplementation(({ from }) => {
        if (from === 'PLN') {
          return Promise.resolve(storedRate({ from: 'PLN', to: 'EUR', rate: '0.25' }));
        }
        return Promise.reject(
          new RateUnsupportedPairError('ecb', from, 'EUR', '2026-06-09', 'unsupported pair')
        );
      });

      const result = await service.convertAtCurrentRate(
        {
          amounts: [
            { currency: 'PLN', amount: 100, count: 1 },
            { currency: 'XXX', amount: 50, count: 1 },
          ],
          displayCurrency: 'EUR',
        },
        NOW
      );

      expect(result.unresolvedNativeCurrencies).toEqual(['XXX']);
      // Only the resolved PLN group (100 * 0.25 = 25) contributes — the
      // unresolvable XXX group is excluded entirely, never guessed at.
      expect(result.convertedTotal).toBe(25);
      expect(result.breakdown).toEqual([
        {
          currency: 'PLN',
          orderCount: 1,
          nativeTotal: 100,
          convertedTotal: 25,
          appliedRate: {
            from: 'PLN',
            to: 'EUR',
            rate: '0.25',
            rateDate: '2026-06-09',
            source: 'nbp',
            derivation: 'direct',
            sourceRef: '149/A/NBP/2026',
          },
        },
        {
          currency: 'XXX',
          orderCount: 1,
          nativeTotal: 50,
          convertedTotal: null,
          appliedRate: null,
        },
      ]);
    });

    it('should group multiple orders sharing a native currency into one rate lookup', async () => {
      rates.getRateFor.mockResolvedValue(storedRate());

      const result = await service.convertAtCurrentRate(
        {
          amounts: [
            { currency: 'PLN', amount: 100, count: 1 },
            { currency: 'PLN', amount: 200, count: 1 },
          ],
          displayCurrency: 'EUR',
        },
        NOW
      );

      expect(rates.getRateFor).toHaveBeenCalledTimes(1);
      expect(result.unresolvedNativeCurrencies).toEqual([]);
      expect(result.convertedTotal).toBe(75); // 300 * 0.25
      expect(result.breakdown[0]).toMatchObject({
        currency: 'PLN',
        orderCount: 2,
        nativeTotal: 300,
        convertedTotal: 75,
      });
    });

    it('should convert a currency matching the display currency with zero calls and no applied rate', async () => {
      const result = await service.convertAtCurrentRate(
        {
          amounts: [{ currency: 'EUR', amount: 100, count: 1 }],
          displayCurrency: 'EUR',
        },
        NOW
      );

      expect(rates.getRateFor).not.toHaveBeenCalled();
      expect(result.convertedTotal).toBe(100);
      expect(result.unresolvedNativeCurrencies).toEqual([]);
      // An identity, not a rate (#2778) — no lookup happened, so nothing
      // should be reported as having produced this figure.
      expect(result.breakdown).toEqual([
        { currency: 'EUR', orderCount: 1, nativeTotal: 100, convertedTotal: 100, appliedRate: null },
      ]);
    });

    it("should sum each amount's own count rather than counting array entries (#2488 review, IMPORTANT 1)", async () => {
      // Mirrors the real controller path: one pre-aggregated bucket per
      // native currency, carrying the TRUE order count for that bucket —
      // not one array entry per order.
      rates.getRateFor.mockResolvedValue(storedRate());

      const result = await service.convertAtCurrentRate(
        {
          amounts: [{ currency: 'PLN', amount: 14000, count: 140 }],
          displayCurrency: 'EUR',
        },
        NOW
      );

      expect(result.breakdown[0]).toMatchObject({
        currency: 'PLN',
        orderCount: 140,
        nativeTotal: 14000,
        convertedTotal: 3500,
      });
    });

    it('should merge counts across multiple entries for the same currency', async () => {
      rates.getRateFor.mockResolvedValue(storedRate());

      const result = await service.convertAtCurrentRate(
        {
          amounts: [
            { currency: 'PLN', amount: 100, count: 3 },
            { currency: 'PLN', amount: 200, count: 5 },
          ],
          displayCurrency: 'EUR',
        },
        NOW
      );

      expect(result.breakdown[0]).toMatchObject({
        currency: 'PLN',
        orderCount: 8,
        nativeTotal: 300,
        convertedTotal: 75,
      });
    });

    it('should report a mixed-currency bucket as unresolved without calling the rate provider (#2488 review, IMPORTANT 2)', async () => {
      rates.getRateFor.mockResolvedValue(storedRate());

      const result = await service.convertAtCurrentRate(
        {
          amounts: [
            { currency: 'PLN', amount: 100, count: 1 },
            { currency: MIXED_NATIVE_CURRENCIES_LABEL, amount: 75, count: 2 },
          ],
          displayCurrency: 'EUR',
        },
        NOW
      );

      expect(result.unresolvedNativeCurrencies).toEqual([MIXED_NATIVE_CURRENCIES_LABEL]);
      // The mixed bucket's 75 is excluded from convertedTotal (unresolved,
      // never guessed at) but is NOT silently dropped — it's reported via
      // unresolvedNativeCurrencies/breakdown above.
      expect(result.convertedTotal).toBe(25);
      expect(result.breakdown).toContainEqual({
        currency: MIXED_NATIVE_CURRENCIES_LABEL,
        orderCount: 2,
        nativeTotal: 75,
        convertedTotal: null,
        appliedRate: null,
      });
      // Never sent to the rate provider — there is no single currency to
      // resolve a rate for.
      expect(rates.getRateFor).not.toHaveBeenCalledWith(
        expect.objectContaining({ from: MIXED_NATIVE_CURRENCIES_LABEL })
      );
    });

    it('should report appliedRate as non-null for every converted row and null exactly for unresolved rows (#2778 AC)', async () => {
      rates.getRateFor.mockImplementation(({ from }) => {
        if (from === 'PLN') {
          return Promise.resolve(storedRate({ from: 'PLN', to: 'EUR' }));
        }
        return Promise.reject(
          new RateUnsupportedPairError('ecb', from, 'EUR', '2026-06-09', 'unsupported pair')
        );
      });

      const result = await service.convertAtCurrentRate(
        {
          amounts: [
            { currency: 'PLN', amount: 100, count: 1 },
            { currency: 'XXX', amount: 50, count: 1 },
          ],
          displayCurrency: 'EUR',
        },
        NOW
      );

      for (const row of result.breakdown) {
        const isUnresolved = result.unresolvedNativeCurrencies.includes(row.currency);
        expect(row.appliedRate === null).toBe(isUnresolved);
        expect(row.convertedTotal === null).toBe(isUnresolved);
      }
    });
  });

  describe('convertAtOrderDate', () => {
    it('should make zero calls and report no applied rate when the display currency equals the reporting currency', async () => {
      const result = await service.convertAtOrderDate(
        { reportingTotal: 500, reportingCurrency: 'EUR', displayCurrency: 'EUR' },
        NOW
      );

      expect(rates.getRateFor).not.toHaveBeenCalled();
      expect(result).toEqual({
        displayCurrency: 'EUR',
        convertedTotal: 500,
        sourceCurrency: 'EUR',
        unresolved: false,
        appliedRate: null,
      });
    });

    it('should make exactly one call, multiply the whole total once, and report the single applied rate for a different display currency', async () => {
      rates.getRateFor.mockResolvedValue(
        storedRate({
          source: 'nbp',
          from: 'EUR',
          to: 'PLN',
          rate: '4.2',
          rateDate: '2026-06-09',
          sourceRef: '149/A/NBP/2026',
        })
      );

      const result = await service.convertAtOrderDate(
        { reportingTotal: 500, reportingCurrency: 'EUR', displayCurrency: 'PLN' },
        NOW
      );

      expect(rates.getRateFor).toHaveBeenCalledTimes(1);
      expect(rates.getRateFor).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'nbp', from: 'EUR', to: 'PLN' })
      );
      expect(result).toEqual({
        displayCurrency: 'PLN',
        convertedTotal: 2100,
        sourceCurrency: 'EUR',
        unresolved: false,
        appliedRate: {
          from: 'EUR',
          to: 'PLN',
          rate: '4.2',
          rateDate: '2026-06-09',
          source: 'nbp',
          derivation: 'direct',
          sourceRef: '149/A/NBP/2026',
        },
      });
    });

    it('should call exactly once regardless of how many orders fed the aggregate total', async () => {
      // The service never sees individual orders in this mode — it receives
      // one already-summed total — so "exactly one call regardless of order
      // count" is inherent to the shape rather than something to loop over.
      rates.getRateFor.mockResolvedValue(storedRate({ from: 'EUR', to: 'PLN', rate: '4.2' }));

      await service.convertAtOrderDate(
        { reportingTotal: 123456.78, reportingCurrency: 'EUR', displayCurrency: 'PLN' },
        NOW
      );

      expect(rates.getRateFor).toHaveBeenCalledTimes(1);
    });

    it('should report unresolved with a null applied rate when the lookup fails (#2778 AC)', async () => {
      rates.getRateFor.mockRejectedValue(
        new RateUnsupportedPairError('nbp', 'EUR', 'PLN', '2026-06-09', 'unsupported pair')
      );

      const result = await service.convertAtOrderDate(
        { reportingTotal: 500, reportingCurrency: 'EUR', displayCurrency: 'PLN' },
        NOW
      );

      expect(result).toEqual({
        displayCurrency: 'PLN',
        convertedTotal: null,
        sourceCurrency: 'EUR',
        unresolved: true,
        appliedRate: null,
      });
    });

    it('should report nothing to convert and a null applied rate when no order in range has been stamped yet (#2778 AC)', async () => {
      const result = await service.convertAtOrderDate(
        { reportingTotal: 0, reportingCurrency: null, displayCurrency: 'PLN' },
        NOW
      );

      expect(rates.getRateFor).not.toHaveBeenCalled();
      expect(result).toEqual({
        displayCurrency: 'PLN',
        convertedTotal: null,
        sourceCurrency: null,
        unresolved: false,
        appliedRate: null,
      });
    });
  });
});
