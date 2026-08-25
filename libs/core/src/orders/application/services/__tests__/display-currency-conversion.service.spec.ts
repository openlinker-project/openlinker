/**
 * Display Currency Conversion Service Spec (#2458, ADR-064, pending in PR #2485)
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { RateUnsupportedPairError } from '@openlinker/core/currency';
import type { ICurrencyRateService } from '@openlinker/core/currency';
import { MIXED_NATIVE_CURRENCIES_LABEL } from '../../../domain/types/display-currency.types';
import { DisplayCurrencyConversionService } from '../display-currency-conversion.service';

// A fixed instant well clear of any provider-calendar edge case — the exact
// candidate day this resolves to is irrelevant to these tests, which only
// assert on `from`/`to` and call counts, never on the date string itself.
const NOW = new Date('2026-06-10T09:00:00.000Z');

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
          return Promise.resolve({ id: 'rate_1', rate: '0.25' } as never);
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
        { currency: 'PLN', orderCount: 1, nativeTotal: 100, convertedTotal: 25 },
        { currency: 'XXX', orderCount: 1, nativeTotal: 50, convertedTotal: null },
      ]);
    });

    it('should group multiple orders sharing a native currency into one rate lookup', async () => {
      rates.getRateFor.mockResolvedValue({ id: 'rate_1', rate: '0.25' } as never);

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
      expect(result.breakdown).toEqual([
        { currency: 'PLN', orderCount: 2, nativeTotal: 300, convertedTotal: 75 },
      ]);
    });

    it('should convert a currency matching the display currency with zero calls', async () => {
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
    });

    it("should sum each amount's own count rather than counting array entries (#2488 review, IMPORTANT 1)", async () => {
      // Mirrors the real controller path: one pre-aggregated bucket per
      // native currency, carrying the TRUE order count for that bucket —
      // not one array entry per order.
      rates.getRateFor.mockResolvedValue({ id: 'rate_1', rate: '0.25' } as never);

      const result = await service.convertAtCurrentRate(
        {
          amounts: [{ currency: 'PLN', amount: 14000, count: 140 }],
          displayCurrency: 'EUR',
        },
        NOW
      );

      expect(result.breakdown).toEqual([
        { currency: 'PLN', orderCount: 140, nativeTotal: 14000, convertedTotal: 3500 },
      ]);
    });

    it('should merge counts across multiple entries for the same currency', async () => {
      rates.getRateFor.mockResolvedValue({ id: 'rate_1', rate: '0.25' } as never);

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

      expect(result.breakdown).toEqual([
        { currency: 'PLN', orderCount: 8, nativeTotal: 300, convertedTotal: 75 },
      ]);
    });

    it('should report a mixed-currency bucket as unresolved without calling the rate provider (#2488 review, IMPORTANT 2)', async () => {
      rates.getRateFor.mockResolvedValue({ id: 'rate_1', rate: '0.25' } as never);

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
      });
      // Never sent to the rate provider — there is no single currency to
      // resolve a rate for.
      expect(rates.getRateFor).not.toHaveBeenCalledWith(
        expect.objectContaining({ from: MIXED_NATIVE_CURRENCIES_LABEL })
      );
    });
  });

  describe('convertAtOrderDate', () => {
    it('should make zero calls when the display currency equals the reporting currency', async () => {
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
      });
    });

    it('should make exactly one call and multiply the whole total once for a different display currency', async () => {
      rates.getRateFor.mockResolvedValue({ id: 'rate_1', rate: '4.2' } as never);

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
      });
    });

    it('should call exactly once regardless of how many orders fed the aggregate total', async () => {
      // The service never sees individual orders in this mode — it receives
      // one already-summed total — so "exactly one call regardless of order
      // count" is inherent to the shape rather than something to loop over.
      rates.getRateFor.mockResolvedValue({ id: 'rate_1', rate: '4.2' } as never);

      await service.convertAtOrderDate(
        { reportingTotal: 123456.78, reportingCurrency: 'EUR', displayCurrency: 'PLN' },
        NOW
      );

      expect(rates.getRateFor).toHaveBeenCalledTimes(1);
    });

    it('should report unresolved without throwing when the rate cannot be resolved', async () => {
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
      });
    });

    it('should report nothing to convert when no order in range has been stamped yet', async () => {
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
      });
    });
  });
});
