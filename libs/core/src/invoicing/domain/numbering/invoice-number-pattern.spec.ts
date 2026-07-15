/**
 * Invoice Number Pattern — unit tests (#1575)
 *
 * @module libs/core/src/invoicing/domain/numbering
 */
import {
  computePeriodKey,
  renderInvoiceNumber,
  validateNumberingPattern,
} from './invoice-number-pattern';

// 2026-05-04 is Q2, month 05, year 2026 (UTC).
const MAY_2026 = new Date('2026-05-04T12:00:00.000Z');
// 2026-01-31 is Q1, month 01.
const JAN_2026 = new Date('2026-01-31T23:00:00.000Z');

describe('renderInvoiceNumber', () => {
  it('substitutes seq with zero-padding and all date variables', () => {
    expect(
      renderInvoiceNumber('FV/{seq}/{MM}/{YYYY}', { seq: 42, seqPadding: 4, issueDate: MAY_2026 }),
    ).toBe('FV/0042/05/2026');
  });

  it('renders {YY} and {QQ}', () => {
    expect(
      renderInvoiceNumber('{YY}-Q{QQ}-{seq}', { seq: 7, seqPadding: 0, issueDate: MAY_2026 }),
    ).toBe('26-Q2-7');
  });

  it('treats non-variable text as a literal', () => {
    expect(
      renderInvoiceNumber('INV-{seq}-END', { seq: 1, seqPadding: 3, issueDate: JAN_2026 }),
    ).toBe('INV-001-END');
  });

  it('does not pad when seqPadding is 0', () => {
    expect(renderInvoiceNumber('{seq}', { seq: 458, seqPadding: 0, issueDate: JAN_2026 })).toBe(
      '458',
    );
  });
});

describe('validateNumberingPattern', () => {
  it('rejects a pattern missing {seq}', () => {
    expect(validateNumberingPattern('FV/{YYYY}', 'none')).toContainEqual(
      expect.stringContaining('{seq}'),
    );
  });

  it('accepts a valid none-policy pattern', () => {
    expect(validateNumberingPattern('FV/{seq}', 'none')).toEqual([]);
  });

  it('requires {MM} and a year for monthly', () => {
    expect(validateNumberingPattern('FV/{seq}/{YYYY}', 'monthly')).not.toEqual([]);
    expect(validateNumberingPattern('FV/{seq}/{MM}/{YYYY}', 'monthly')).toEqual([]);
    expect(validateNumberingPattern('FV/{seq}/{MM}/{YY}', 'monthly')).toEqual([]);
  });

  it('requires {QQ} and a year for quarterly', () => {
    expect(validateNumberingPattern('FV/{seq}/{QQ}', 'quarterly')).not.toEqual([]);
    expect(validateNumberingPattern('FV/{seq}/{QQ}/{YYYY}', 'quarterly')).toEqual([]);
  });

  it('requires a year for yearly', () => {
    expect(validateNumberingPattern('FV/{seq}', 'yearly')).not.toEqual([]);
    expect(validateNumberingPattern('FV/{seq}/{YYYY}', 'yearly')).toEqual([]);
  });
});

describe('computePeriodKey', () => {
  it('is constant (empty) for none', () => {
    expect(computePeriodKey('none', MAY_2026)).toBe('');
    expect(computePeriodKey('none', JAN_2026)).toBe('');
  });

  it('keys by year for yearly', () => {
    expect(computePeriodKey('yearly', MAY_2026)).toBe('2026');
  });

  it('keys by year-month for monthly', () => {
    expect(computePeriodKey('monthly', MAY_2026)).toBe('2026-05');
    expect(computePeriodKey('monthly', JAN_2026)).toBe('2026-01');
  });

  it('keys by year-quarter for quarterly', () => {
    expect(computePeriodKey('quarterly', MAY_2026)).toBe('2026-Q2');
    expect(computePeriodKey('quarterly', JAN_2026)).toBe('2026-Q1');
  });
});
