/**
 * Invoice numbering pattern — pure renderer + validator (FE mirror of core)
 *
 * Client-side copies of the core domain helpers (`renderInvoiceNumber`,
 * `validateNumberingPattern`) so the numbering editor can render a live preview
 * and surface validation without a round-trip. The API/domain stays the source
 * of truth: these functions exist for UX only and are kept behaviourally aligned
 * with `libs/core/src/invoicing/domain/numbering/invoice-number-pattern.ts`.
 *
 * Date variables resolve from the document's ISSUE DATE. An optional `timeZone`
 * (an IANA zone id) makes the rendered parts match the seller's local calendar
 * day — the same seam the core renderer uses. When absent, parts resolve in UTC
 * (a neutral fallback for callers that do not thread a zone).
 *
 * @module apps/web/src/features/invoicing/lib
 */
import type { ResetPolicy } from '../api/numbering.types';

const SEQ_VAR = '{seq}';
const MONTH_VAR = '{MM}';
const QUARTER_VAR = '{QQ}';
const DAY_VAR = '{DD}';
/** A year variable disambiguates a reset cadence: {YYYY}, {YY}, or {FY}. */
const YEAR_VARS = ['{YYYY}', '{YY}', '{FY}'] as const;
/** Default fiscal-year start month — January, i.e. the fiscal year is the calendar year. */
const DEFAULT_FISCAL_YEAR_START_MONTH = 1;

/**
 * Fiscal-year label for an issue date under a start month (mirrors core #1692):
 * a fiscal year is labelled by the calendar year it STARTS in. Issue month ≥
 * start → this calendar year; month < start → the previous year. Start month 1
 * always yields the calendar year, so {FY} === {YYYY}.
 */
function fiscalYearLabel(year: number, month: number, startMonth: number): number {
  return month >= startMonth ? year : year - 1;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Resolve the year/month/day an instant falls on in `timeZone` via `Intl`
 * (framework-free, deterministic). Falls back to UTC when no zone is given.
 */
function zonedParts(date: Date, timeZone?: string): ZonedDateParts {
  if (!timeZone) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = (type: 'year' | 'month' | 'day'): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: lookup('year'), month: lookup('month'), day: lookup('day') };
}

function quarterOf(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export interface NumberRenderContext {
  seq: number;
  seqPadding: number;
  issueDate: Date;
  /** IANA zone id; date parts resolve in this zone (UTC when absent). */
  timeZone?: string;
  /** Fiscal-year start month (1-12) governing {FY}; absent / 1 = calendar year. */
  fiscalYearStartMonth?: number;
}

/**
 * Render a document number from a pattern. Unknown `{...}` tokens are left as
 * literals. Pure — no I/O. `{FY}` resolves from `fiscalYearStartMonth` (mirrors
 * core #1692); equal to `{YYYY}` when the start month is 1 / absent.
 */
export function renderInvoiceNumber(pattern: string, ctx: NumberRenderContext): string {
  const { year, month, day } = zonedParts(ctx.issueDate, ctx.timeZone);
  const startMonth = ctx.fiscalYearStartMonth ?? DEFAULT_FISCAL_YEAR_START_MONTH;
  const fiscalYear = fiscalYearLabel(year, month, startMonth);
  const replacements: Record<string, string> = {
    '{seq}': String(ctx.seq).padStart(Math.max(ctx.seqPadding, 0), '0'),
    '{YYYY}': String(year).padStart(4, '0'),
    '{YY}': pad2(year % 100),
    '{MM}': pad2(month),
    '{QQ}': String(quarterOf(month)),
    '{DD}': pad2(day),
    '{FY}': String(fiscalYear).padStart(4, '0'),
  };
  return pattern.replace(
    /\{(seq|YYYY|YY|MM|QQ|DD|FY)\}/g,
    (token) => replacements[token] ?? token,
  );
}

/**
 * Validate a pattern against a reset policy (UX mirror of the core rule).
 * Returns a flat list of human-readable issues; empty means valid. Pure.
 */
export function validateNumberingPattern(pattern: string, resetPolicy: ResetPolicy): string[] {
  const errors: string[] = [];
  if (!pattern.includes(SEQ_VAR)) {
    errors.push('Add the {seq} variable — a series without a sequence number is not valid.');
  }

  const hasYear = YEAR_VARS.some((v) => pattern.includes(v));
  const hasMonth = pattern.includes(MONTH_VAR);
  const hasQuarter = pattern.includes(QUARTER_VAR);
  const hasDay = pattern.includes(DAY_VAR);

  switch (resetPolicy) {
    case 'daily':
      if (!hasDay || !hasMonth || !hasYear) {
        errors.push(
          'Daily reset needs {DD}, {MM} and a year ({YYYY}, {YY} or {FY}) in the pattern, or numbers repeat.',
        );
      }
      break;
    case 'monthly':
      if (!hasMonth || !hasYear) {
        errors.push(
          'Monthly reset needs {MM} and a year ({YYYY}, {YY} or {FY}) in the pattern, or numbers repeat.',
        );
      }
      break;
    case 'quarterly':
      if (!hasQuarter || !hasYear) {
        errors.push(
          'Quarterly reset needs {QQ} and a year ({YYYY}, {YY} or {FY}) in the pattern, or numbers repeat.',
        );
      }
      break;
    case 'yearly':
      if (!hasYear) {
        errors.push(
          'Yearly reset needs a year ({YYYY}, {YY} or {FY}) in the pattern, or numbers repeat.',
        );
      }
      break;
    case 'none':
      break;
  }
  return errors;
}
