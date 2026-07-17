/**
 * COD currency capability map — unit tests (#1569)
 *
 * Pins the per-carrier sets to the backend sources of truth and covers the
 * fallback + clamp helpers that drive the generate-label COD field.
 */
import { describe, it, expect } from 'vitest';

import {
  COD_CURRENCY_VALUES,
  COD_CURRENCIES_BY_PLATFORM,
  codCurrenciesForPlatform,
  clampCodCurrency,
} from './cod-currencies';

describe('cod-currencies — per-carrier sets (drift guard)', () => {
  it('should carry DPD full set PLN/EUR/RON/CZK (mirrors DpdCodCurrencyValues)', () => {
    expect(COD_CURRENCIES_BY_PLATFORM.dpd).toEqual(['PLN', 'EUR', 'RON', 'CZK']);
  });

  it('should carry InPost PLN-only (mirrors SHIPX_COD_CURRENCIES)', () => {
    expect(COD_CURRENCIES_BY_PLATFORM.inpost).toEqual(['PLN']);
  });

  it('should expose the union as the fallback vocabulary', () => {
    expect(COD_CURRENCY_VALUES).toEqual(['PLN', 'EUR', 'RON', 'CZK']);
  });

  it('should keep the union equal to the de-duplicated union of every per-platform set', () => {
    const perPlatformUnion = [
      ...new Set(Object.values(COD_CURRENCIES_BY_PLATFORM).flat()),
    ].sort();
    expect([...COD_CURRENCY_VALUES].sort()).toEqual(perPlatformUnion);
  });
});

describe('codCurrenciesForPlatform', () => {
  it('should scope to the carrier set for a known platformType', () => {
    expect(codCurrenciesForPlatform('dpd')).toEqual(['PLN', 'EUR', 'RON', 'CZK']);
    expect(codCurrenciesForPlatform('inpost')).toEqual(['PLN']);
  });

  it('should fall back to the union when the carrier is unknown or absent', () => {
    expect(codCurrenciesForPlatform(undefined)).toEqual(COD_CURRENCY_VALUES);
    expect(codCurrenciesForPlatform('allegro')).toEqual(COD_CURRENCY_VALUES);
    expect(codCurrenciesForPlatform('')).toEqual(COD_CURRENCY_VALUES);
  });
});

describe('clampCodCurrency', () => {
  it('should keep the desired currency when the carrier allows it', () => {
    expect(clampCodCurrency('EUR', ['PLN', 'EUR', 'RON', 'CZK'])).toBe('EUR');
  });

  it('should fall back to the first allowed currency when the desired one is not accepted', () => {
    expect(clampCodCurrency('EUR', ['PLN'])).toBe('PLN');
    expect(clampCodCurrency('CZK', ['PLN'])).toBe('PLN');
  });

  it('should fall back to the first allowed currency when no currency is desired', () => {
    expect(clampCodCurrency(undefined, ['PLN', 'EUR'])).toBe('PLN');
  });
});
