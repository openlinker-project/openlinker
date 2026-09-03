import { describe, expect, it } from 'vitest';
import type { AppliedRate } from '../api/sales-analytics.types';
import {
  buildRateProvenanceDefinitions,
  createReportingCurrencyConverter,
  formatAppliedRateLine,
  pickInlineAppliedRate,
  resolveReportingCurrencyRate,
} from './display-currency.lib';

function rate(overrides: Partial<AppliedRate> = {}): AppliedRate {
  return {
    from: 'EUR',
    to: 'PLN',
    rate: '4.25',
    rateDate: '2026-08-29',
    source: 'nbp',
    derivation: 'direct',
    sourceRef: '167/A/NBP/2026',
    ...overrides,
  };
}

// `formatAppliedRateLine` / `buildRateProvenanceDefinitions` are pure lib
// functions and cannot call the `useNumberFormat` hook themselves, so the
// caller supplies the formatter — matching what `AnalyticsKpiStrip`
// constructs via `useNumberFormat(RATE_FORMAT_OPTIONS)` (#2788 review).
const rateFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});

describe('pickInlineAppliedRate', () => {
  it('returns the single rate when exactly one is present', () => {
    const only = rate();
    expect(pickInlineAppliedRate([only])).toBe(only);
  });

  it('returns null when no rate was applied — nothing to name inline', () => {
    expect(pickInlineAppliedRate([])).toBeNull();
  });

  it('returns null when several distinct rates fed the figure — never picks just one', () => {
    expect(pickInlineAppliedRate([rate({ from: 'EUR' }), rate({ from: 'USD' })])).toBeNull();
  });
});

describe('formatAppliedRateLine', () => {
  it('renders every value verbatim from the rate, never a hardcoded label', () => {
    expect(formatAppliedRateLine(rate(), rateFormat)).toBe('1 EUR = 4.25 PLN (NBP, 2026-08-29)');
  });

  it('formats with up to 8 fraction digits without trailing zero padding beyond the source precision', () => {
    expect(formatAppliedRateLine(rate({ rate: '4.23680000' }), rateFormat)).toBe(
      '1 EUR = 4.2368 PLN (NBP, 2026-08-29)'
    );
  });

  it('renders a full 8-decimal inverted rate unrounded — this line is the checkable provenance figure (#2788 review)', () => {
    // An inverted PLN→EUR rate of 0.23529412 previously rendered as 0.2353
    // (maximumFractionDigits: 4), so multiplying the displayed amount by the
    // displayed rate no longer reproduced the displayed figure.
    expect(formatAppliedRateLine(rate({ from: 'PLN', to: 'EUR', rate: '0.23529412' }), rateFormat)).toBe(
      '1 PLN = 0.23529412 EUR (NBP, 2026-08-29)'
    );
  });
});

describe('buildRateProvenanceDefinitions', () => {
  it('returns nothing when no rate was applied — never an empty popover', () => {
    expect(buildRateProvenanceDefinitions('current-rate', [], rateFormat)).toEqual([]);
  });

  it("states the order-date mode's meaning distinctly from current-rate, and the term no longer contradicts the body (#2788 review)", () => {
    const orderDateDefs = buildRateProvenanceDefinitions('order-date', [rate()], rateFormat);
    expect(orderDateDefs[0].term).toBe('Period rate (order-date mode)');
    expect(orderDateDefs[0].text).toMatch(/whole period's total/);

    const currentRateDefs = buildRateProvenanceDefinitions('current-rate', [rate()], rateFormat);
    expect(currentRateDefs[0].term).toBe('Current rate');
  });

  it('includes one row per applied rate, each with its own formatted line (#2778 AC)', () => {
    const defs = buildRateProvenanceDefinitions(
      'current-rate',
      [rate({ from: 'EUR', to: 'PLN' }), rate({ from: 'USD', to: 'PLN', rate: '4.00', sourceRef: null })],
      rateFormat
    );

    expect(defs).toContainEqual(
      expect.objectContaining({ term: 'EUR → PLN', text: '1 EUR = 4.25 PLN (NBP, 2026-08-29)' })
    );
    expect(defs).toContainEqual(
      expect.objectContaining({ term: 'USD → PLN', text: '1 USD = 4.00 PLN (NBP, 2026-08-29)' })
    );
  });

  it('always states the figure is not an invoice/statutory rate', () => {
    const defs = buildRateProvenanceDefinitions('current-rate', [rate()], rateFormat);
    expect(defs.some((d) => d.term === 'Not an invoice rate')).toBe(true);
  });

  it('surfaces derivation and sourceRef, omitting a sourceRef-less caveat rather than rendering an empty label', () => {
    const directWithRef = buildRateProvenanceDefinitions('current-rate', [rate()], rateFormat)[1];
    expect(directWithRef.caveat).toBe('167/A/NBP/2026');

    const invertedNoRef = buildRateProvenanceDefinitions(
      'current-rate',
      [rate({ derivation: 'inverted', sourceRef: null })],
      rateFormat
    )[1];
    expect(invertedNoRef.caveat).toBe('Derived (inverted)');

    const directNoRef = buildRateProvenanceDefinitions(
      'current-rate',
      [rate({ sourceRef: null })],
      rateFormat
    )[1];
    expect(directNoRef.caveat).toBeUndefined();
  });
});

describe('resolveReportingCurrencyRate', () => {
  it('returns null when there is no conversion at all', () => {
    expect(resolveReportingCurrencyRate(undefined, 'PLN')).toBeNull();
  });

  it('returns null when the native currency is unknown (headline.currency is null)', () => {
    expect(
      resolveReportingCurrencyRate(
        { rateBasis: 'current-rate', displayCurrency: 'PLN', appliedRates: [rate()] },
        null
      )
    ).toBeNull();
  });

  it('order-date mode: returns the single applied rate verbatim — never more than one exists', () => {
    const only = rate({ from: 'PLN', to: 'EUR' });
    expect(
      resolveReportingCurrencyRate(
        { rateBasis: 'order-date', displayCurrency: 'EUR', appliedRates: [only] },
        'PLN'
      )
    ).toBe(only);
  });

  it('order-date mode: returns null when no rate was applied', () => {
    expect(
      resolveReportingCurrencyRate(
        { rateBasis: 'order-date', displayCurrency: 'EUR', appliedRates: [] },
        'PLN'
      )
    ).toBeNull();
  });

  it("current-rate mode: finds the ONE breakdown row whose `from` matches the native currency", () => {
    const plnRate = rate({ from: 'PLN', to: 'EUR', rate: '0.236' });
    const usdRate = rate({ from: 'USD', to: 'EUR', rate: '0.92' });
    expect(
      resolveReportingCurrencyRate(
        { rateBasis: 'current-rate', displayCurrency: 'EUR', appliedRates: [usdRate, plnRate] },
        'PLN'
      )
    ).toBe(plnRate);
  });

  it('current-rate mode: returns null when no bucket matches the native currency — never picks a wrong one', () => {
    const usdRate = rate({ from: 'USD', to: 'EUR' });
    expect(
      resolveReportingCurrencyRate(
        { rateBasis: 'current-rate', displayCurrency: 'EUR', appliedRates: [usdRate] },
        'PLN'
      )
    ).toBeNull();
  });

  it("returns null when `from` matches but `to` doesn't match the requested display currency", () => {
    const wrongTarget = rate({ from: 'PLN', to: 'USD' });
    expect(
      resolveReportingCurrencyRate(
        { rateBasis: 'current-rate', displayCurrency: 'EUR', appliedRates: [wrongTarget] },
        'PLN'
      )
    ).toBeNull();
  });
});

describe('createReportingCurrencyConverter', () => {
  it('applies the rate to an amount denominated in the reporting currency', () => {
    const converter = createReportingCurrencyConverter(rate({ from: 'PLN', to: 'EUR' }), 'PLN');
    expect(converter.convertToDisplay(100, 'PLN')).toBeCloseTo(425);
    expect(converter.displayCurrencyFor('PLN')).toBe('EUR');
  });

  it('does NOT apply the rate to an amount in a different native currency, even with a resolved rate (defence in depth, PR #2788)', () => {
    const converter = createReportingCurrencyConverter(rate({ from: 'PLN', to: 'EUR' }), 'PLN');
    expect(converter.convertToDisplay(100, 'USD')).toBe(100);
    expect(converter.displayCurrencyFor('USD')).toBe('USD');
  });

  it('passes the amount through natively when there is no resolved rate', () => {
    const converter = createReportingCurrencyConverter(null, 'PLN');
    expect(converter.convertToDisplay(100, 'PLN')).toBe(100);
    expect(converter.displayCurrencyFor('PLN')).toBe('PLN');
  });
});
