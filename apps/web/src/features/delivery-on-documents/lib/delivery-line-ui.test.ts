/**
 * delivery-line-ui tests (#3908)
 *
 * @module apps/web/src/features/delivery-on-documents/lib
 */
import { describe, expect, it } from 'vitest';
import {
  checkName,
  configFromRules,
  rulesFromConfig,
  settingsFromSuggestion,
  splitByValue,
  stillEqualsSuggestion,
} from './delivery-line-ui';

const SUGGESTION = {
  country: 'PL',
  defaultName: 'Koszt dostawy',
  nameSuggestions: ['Koszt dostawy'],
  rateMode: 'goods' as const,
  omitFreeDelivery: true,
  sources: [],
  sourceLabel: '',
  sourceUrl: '',
  disclaimer: '',
};

describe('delivery-line-ui', () => {
  it('should always end the table with an "All other countries" row', () => {
    const rules = rulesFromConfig(null);

    expect(rules).toHaveLength(1);
    expect(rules[0].country).toBeNull();
  });

  it('should round-trip rows through config', () => {
    const config = {
      default: { name: 'Shipping', rate: 'goods', freeDelivery: 'omit', rateFormat: 'plain' },
      countries: {
        PL: {
          name: 'Koszt dostawy',
          rate: 'fixed',
          fixedRate: '23',
          freeDelivery: 'show',
          rateFormat: 'brackets',
        },
      },
    } as const;

    expect(configFromRules(rulesFromConfig(config))).toEqual(config);
  });

  it('should stop matching a suggestion once a field changes', () => {
    const filled = settingsFromSuggestion(SUGGESTION);

    expect(stillEqualsSuggestion(filled, SUGGESTION)).toBe(true);
    expect(stillEqualsSuggestion({ ...filled, name: 'Dostawa' }, SUGGESTION)).toBe(false);
  });

  it('should refuse a name that carries a rate or is too long', () => {
    expect(checkName('Dostawa 23%', 'plain').error).toMatch(/VAT rate/);
    expect(checkName('x'.repeat(40), 'plain').error).toMatch(/at most 36/);
    expect(checkName('  Dostawa ', 'plain')).toEqual({ name: 'Dostawa', error: null });
  });

  it('should split delivery by value and keep the total exact', () => {
    const parts = splitByValue(15, [
      { name: 'a', gross: 60, rate: '23' },
      { name: 'b', gross: 40, rate: '5' },
    ]);

    expect(parts).toEqual([
      { rate: '23', amount: 9 },
      { rate: '5', amount: 6 },
    ]);
  });
});
