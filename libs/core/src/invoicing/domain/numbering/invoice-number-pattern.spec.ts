/**
 * Invoice Number Pattern — unit tests (#1575)
 *
 * @module libs/core/src/invoicing/domain/numbering
 */
import {
  assertDocumentNumberWithinLength,
  computePeriodKey,
  renderInvoiceNumber,
  validateNumberingPattern,
} from './invoice-number-pattern';
import { DocumentNumberTooLongException } from '../exceptions/document-number-too-long.exception';

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

  it('renders {DD} (day) and {FY} (fiscal year == calendar year today)', () => {
    expect(
      renderInvoiceNumber('{seq}/{DD}/{MM}/{FY}', { seq: 3, seqPadding: 2, issueDate: MAY_2026 }),
    ).toBe('03/04/05/2026');
  });

  it('renders {FY} == {YYYY} when the fiscal year starts in January (default, #1692)', () => {
    expect(
      renderInvoiceNumber('{seq}/{FY}', { seq: 1, seqPadding: 0, issueDate: MAY_2026 }),
    ).toBe('1/2026');
    expect(
      renderInvoiceNumber('{seq}/{FY}', {
        seq: 1,
        seqPadding: 0,
        issueDate: MAY_2026,
        fiscalYearStartMonth: 1,
      }),
    ).toBe('1/2026');
  });

  it('labels {FY} by the calendar year the fiscal year STARTS in (#1692)', () => {
    // Fiscal year starts in July. May 2026 (month 5 < 7) falls in the fiscal year
    // that started in July 2025 → label 2025.
    expect(
      renderInvoiceNumber('{seq}/{FY}', {
        seq: 1,
        seqPadding: 0,
        issueDate: MAY_2026,
        fiscalYearStartMonth: 7,
      }),
    ).toBe('1/2025');
    // An August 2026 issue (month 8 ≥ 7) is in the fiscal year that started July 2026 → 2026.
    expect(
      renderInvoiceNumber('{seq}/{FY}', {
        seq: 1,
        seqPadding: 0,
        issueDate: new Date('2026-08-15T12:00:00.000Z'),
        fiscalYearStartMonth: 7,
      }),
    ).toBe('1/2026');
  });

  it('resolves date variables in the seller timezone (#7)', () => {
    // 2026-01-31T23:00:00Z is Feb 1 (00:00) in Europe/Warsaw (UTC+1 in winter).
    expect(
      renderInvoiceNumber('{seq}/{DD}/{MM}/{YYYY}', {
        seq: 1,
        seqPadding: 0,
        issueDate: JAN_2026,
        timeZone: 'Europe/Warsaw',
      }),
    ).toBe('1/01/02/2026');
    // Same instant in UTC stays Jan 31.
    expect(
      renderInvoiceNumber('{seq}/{DD}/{MM}/{YYYY}', {
        seq: 1,
        seqPadding: 0,
        issueDate: JAN_2026,
        timeZone: 'UTC',
      }),
    ).toBe('1/31/01/2026');
  });
});

describe('assertDocumentNumberWithinLength', () => {
  it('does not throw when within (or at) the limit, or when no limit is set', () => {
    expect(() => assertDocumentNumberWithinLength('FV/0001', 256)).not.toThrow();
    expect(() => assertDocumentNumberWithinLength('ABCDE', 5)).not.toThrow();
    expect(() => assertDocumentNumberWithinLength('x'.repeat(1000))).not.toThrow();
    expect(() => assertDocumentNumberWithinLength('x'.repeat(1000), 0)).not.toThrow();
  });

  it('throws DocumentNumberTooLongException when the rendered number exceeds the limit', () => {
    expect(() => assertDocumentNumberWithinLength('ABCDEF', 5)).toThrow(
      DocumentNumberTooLongException,
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

  it('accepts {FY} as a year disambiguator', () => {
    expect(validateNumberingPattern('FV/{seq}/{FY}', 'yearly')).toEqual([]);
    expect(validateNumberingPattern('FV/{seq}/{MM}/{FY}', 'monthly')).toEqual([]);
  });

  it('requires {DD}, {MM} and a year for daily (#1692)', () => {
    expect(validateNumberingPattern('FV/{seq}/{MM}/{YYYY}', 'daily')).not.toEqual([]);
    expect(validateNumberingPattern('FV/{seq}/{DD}/{YYYY}', 'daily')).not.toEqual([]);
    expect(validateNumberingPattern('FV/{seq}/{DD}/{MM}', 'daily')).not.toEqual([]);
    expect(validateNumberingPattern('FV/{seq}/{DD}/{MM}/{YYYY}', 'daily')).toEqual([]);
    expect(validateNumberingPattern('FV/{seq}/{DD}/{MM}/{FY}', 'daily')).toEqual([]);
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

  it('keys by year-month-day for daily (#1692)', () => {
    expect(computePeriodKey('daily', MAY_2026)).toBe('2026-05-04');
    expect(computePeriodKey('daily', JAN_2026)).toBe('2026-01-31');
  });

  it('resolves the daily bucket in the seller timezone (#1692)', () => {
    // 2026-01-31T23:00Z is Feb 1 in Europe/Warsaw → the daily bucket rolls to the next day.
    expect(computePeriodKey('daily', JAN_2026, 'Europe/Warsaw')).toBe('2026-02-01');
    expect(computePeriodKey('daily', JAN_2026, 'UTC')).toBe('2026-01-31');
  });

  it('resolves the period bucket in the seller timezone (#7)', () => {
    // 2026-01-31T23:00Z rolls to Feb in Europe/Warsaw → the monthly bucket moves.
    expect(computePeriodKey('monthly', JAN_2026, 'Europe/Warsaw')).toBe('2026-02');
    expect(computePeriodKey('monthly', JAN_2026, 'UTC')).toBe('2026-01');
  });
});
