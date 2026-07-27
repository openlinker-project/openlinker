/**
 * numbering-pattern (FE mirror) unit tests (#1577)
 *
 * @module apps/web/src/features/invoicing/lib
 */
import { describe, expect, it } from 'vitest';
import { renderInvoiceNumber, validateNumberingPattern } from './numbering-pattern';

// 2026-07-15 UTC — a month/quarter/year with distinct values.
const ISSUE_DATE = new Date('2026-07-15T00:00:00Z');

describe('renderInvoiceNumber', () => {
  it('substitutes {seq} zero-padded and resolves date variables in UTC', () => {
    expect(renderInvoiceNumber('FV/{seq}/{MM}/{YYYY}', { seq: 42, seqPadding: 5, issueDate: ISSUE_DATE })).toBe(
      'FV/00042/07/2026',
    );
  });

  it('renders {YY} and {QQ}', () => {
    expect(renderInvoiceNumber('{YY}-Q{QQ}-{seq}', { seq: 1, seqPadding: 0, issueDate: ISSUE_DATE })).toBe(
      '26-Q3-1',
    );
  });

  it('leaves literals untouched', () => {
    expect(renderInvoiceNumber('INV-{seq}', { seq: 7, seqPadding: 3, issueDate: ISSUE_DATE })).toBe('INV-007');
  });

  it('renders {FY} == {YYYY} by default and diverges with a non-January start (#1692)', () => {
    expect(renderInvoiceNumber('{seq}/{FY}', { seq: 1, seqPadding: 0, issueDate: ISSUE_DATE })).toBe(
      '1/2026',
    );
    // Fiscal year starts in October; July 2026 (month 7 < 10) → started Oct 2025 → 2025.
    expect(
      renderInvoiceNumber('{seq}/{FY}', {
        seq: 1,
        seqPadding: 0,
        issueDate: ISSUE_DATE,
        fiscalYearStartMonth: 10,
      }),
    ).toBe('1/2025');
  });
});

describe('validateNumberingPattern', () => {
  it('requires {seq}', () => {
    expect(validateNumberingPattern('FV/{YYYY}', 'none')).toHaveLength(1);
  });

  it('accepts a valid none-reset pattern', () => {
    expect(validateNumberingPattern('FV/{seq}', 'none')).toEqual([]);
  });

  it('flags monthly reset without {MM} + year', () => {
    expect(validateNumberingPattern('FV/{seq}/{YYYY}', 'monthly')).toHaveLength(1);
    expect(validateNumberingPattern('FV/{seq}/{MM}/{YYYY}', 'monthly')).toEqual([]);
  });

  it('flags quarterly reset without {QQ} + year', () => {
    expect(validateNumberingPattern('FV/{seq}/{YYYY}', 'quarterly')).toHaveLength(1);
    expect(validateNumberingPattern('FV/{seq}/Q{QQ}/{YY}', 'quarterly')).toEqual([]);
  });

  it('flags yearly reset without a year variable', () => {
    expect(validateNumberingPattern('FV/{seq}/{MM}', 'yearly')).toHaveLength(1);
    expect(validateNumberingPattern('FV/{seq}/{YY}', 'yearly')).toEqual([]);
  });

  it('flags daily reset without {DD} + {MM} + year (#1692)', () => {
    expect(validateNumberingPattern('FV/{seq}/{MM}/{YYYY}', 'daily')).toHaveLength(1);
    expect(validateNumberingPattern('FV/{seq}/{DD}/{MM}/{YYYY}', 'daily')).toEqual([]);
  });
});
