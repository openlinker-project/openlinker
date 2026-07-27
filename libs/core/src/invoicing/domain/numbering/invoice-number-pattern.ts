/**
 * Invoice Number Pattern — pure renderer, validator, and period-key helpers
 *
 * Pure, framework-free functions (#1575) that turn a numbering-series pattern
 * into a concrete document number, validate a pattern against its reset policy,
 * and compute the opaque period key the atomic allocation compares to detect a
 * period rollover. Country-agnostic (ADR-026): positional variables only, no
 * provider/country vocabulary.
 *
 * Date variables resolve from the document's legal ISSUE DATE in the SELLER
 * TIMEZONE (#7). A `NumberRenderContext.timeZone` (an IANA zone id supplied by
 * the provider adapter — never hardcoded here) makes the rendered number and the
 * period-reset bucket agree with the seller's local calendar day, so an
 * issuance just after local midnight at a month/year boundary lands in the
 * correct period. When `timeZone` is absent the parts resolve in UTC (a neutral
 * fallback for callers — e.g. a cosmetic preview — that do not thread a zone).
 *
 * Pattern variables (anything else is a literal):
 *   {seq}  — the allocated sequence number, zero-padded to `seqPadding`
 *   {YYYY} — 4-digit year        {YY} — 2-digit year
 *   {MM}   — 2-digit month 01–12 {QQ} — calendar quarter 1–4
 *   {DD}   — 2-digit day 01–31   {FY} — 4-digit fiscal year (configurable start
 *                                       month, #1692; == calendar year by default)
 *
 * @module libs/core/src/invoicing/domain/numbering
 */
import type {
  NumberRenderContext,
  ResetPolicy,
} from '../types/invoice-numbering.types';
import { NumberingYearVariableValues } from '../types/invoice-numbering.types';
import { InvalidNumberingPatternException } from '../exceptions/invalid-numbering-pattern.exception';
import { DocumentNumberTooLongException } from '../exceptions/document-number-too-long.exception';

const SEQ_VAR = '{seq}';
const MONTH_VAR = '{MM}';
const QUARTER_VAR = '{QQ}';
const DAY_VAR = '{DD}';

/** Default fiscal-year start month — January, i.e. the fiscal year is the calendar year. */
const DEFAULT_FISCAL_YEAR_START_MONTH = 1;

/**
 * Compute the fiscal-year LABEL for an issue date under a start month (#1692).
 * Convention: a fiscal year is labelled by the calendar year in which it STARTS.
 * With `startMonth` = M, an issue in month ≥ M belongs to the fiscal year that
 * started this calendar year (label = `year`); an issue in a month < M belongs
 * to the fiscal year that started last calendar year (label = `year - 1`). When
 * `startMonth` = 1 every month is ≥ 1, so the label is always the calendar year
 * and `{FY}` === `{YYYY}` (back-compatible). Pure.
 */
function fiscalYearLabel(year: number, month: number, startMonth: number): number {
  return month >= startMonth ? year : year - 1;
}

/** Calendar parts of an instant resolved in an IANA timezone (UTC when absent). */
interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Resolve the year/month/day an instant falls on in `timeZone` (an IANA zone id)
 * via `Intl` — framework-free and deterministic. Falls back to UTC when no zone
 * is given. An invalid zone id would make `Intl.DateTimeFormat` throw; callers
 * supply validated zones (the provider adapter owns the value).
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

/**
 * Render a document number from a pattern. Unknown `{...}` tokens are left as
 * literals (the validator forbids them at create/update time, so a rendered
 * number never carries an unresolved token in practice). Date parts resolve in
 * `ctx.timeZone` (UTC when absent). Pure — no I/O.
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
    // Fiscal year (#1692): a distinct token from {YYYY} that resolves from the
    // series' configurable start month. Equal to {YYYY} when the start month is 1.
    '{FY}': String(fiscalYear).padStart(4, '0'),
  };
  return pattern.replace(
    /\{(seq|YYYY|YY|MM|QQ|DD|FY)\}/g,
    (token) => replacements[token] ?? token,
  );
}

/**
 * Validate a pattern against a reset policy (#1575). Returns a flat list of
 * human-readable issues; empty means valid. Rules:
 *   - `{seq}` is required (a series with no sequence is meaningless).
 *   - the reset cadence must be disambiguated by the pattern, or a reset would
 *     re-render an already-issued number:
 *       daily     → needs {DD} + {MM} + a year variable
 *       monthly   → needs {MM} + a year variable
 *       quarterly → needs {QQ} + a year variable
 *       yearly    → needs a year variable
 *       none      → no additional requirement
 * A year variable is `{YYYY}`, `{YY}`, or `{FY}` (see `NumberingYearVariableValues`).
 * Pure — no I/O, no throwing.
 */
export function validateNumberingPattern(pattern: string, resetPolicy: ResetPolicy): string[] {
  const errors: string[] = [];
  if (!pattern.includes(SEQ_VAR)) {
    errors.push('Pattern must contain the {seq} variable.');
  }

  const hasYear = NumberingYearVariableValues.some((v) => pattern.includes(v));
  const hasMonth = pattern.includes(MONTH_VAR);
  const hasQuarter = pattern.includes(QUARTER_VAR);
  const hasDay = pattern.includes(DAY_VAR);

  switch (resetPolicy) {
    case 'daily':
      if (!hasDay || !hasMonth || !hasYear) {
        errors.push(
          'A daily reset policy requires the {DD}, {MM} and a year ({YYYY}, {YY} or {FY}) variable.',
        );
      }
      break;
    case 'monthly':
      if (!hasMonth || !hasYear) {
        errors.push('A monthly reset policy requires the {MM} and a year ({YYYY}, {YY} or {FY}) variable.');
      }
      break;
    case 'quarterly':
      if (!hasQuarter || !hasYear) {
        errors.push('A quarterly reset policy requires the {QQ} and a year ({YYYY}, {YY} or {FY}) variable.');
      }
      break;
    case 'yearly':
      if (!hasYear) {
        errors.push('A yearly reset policy requires a year ({YYYY}, {YY} or {FY}) variable.');
      }
      break;
    case 'none':
      break;
  }
  return errors;
}

/**
 * Throwing companion to {@link validateNumberingPattern} for the create/update
 * path: raises {@link InvalidNumberingPatternException} with the full issue list
 * when the pattern is invalid, otherwise returns void.
 */
export function assertValidNumberingPattern(pattern: string, resetPolicy: ResetPolicy): void {
  const issues = validateNumberingPattern(pattern, resetPolicy);
  if (issues.length > 0) {
    throw new InvalidNumberingPatternException(issues);
  }
}

/**
 * Guard a rendered document number against a provider's max-length limit (#11).
 * A provider that declares `maxDocumentNumberLength` (e.g. KSeF's FA(3) `P_2` =
 * 256) must never be handed an over-length number — a long literal-heavy pattern
 * would otherwise only fail at the provider. Throws
 * {@link DocumentNumberTooLongException} when `rendered` exceeds `maxLength`;
 * `undefined`/non-positive `maxLength` means "no limit" and is a no-op. Pure.
 */
export function assertDocumentNumberWithinLength(rendered: string, maxLength?: number): void {
  if (maxLength === undefined || maxLength <= 0) {
    return;
  }
  if (rendered.length > maxLength) {
    throw new DocumentNumberTooLongException(rendered.length, maxLength);
  }
}

/**
 * Compute the opaque period key a document issued on `issueDate` belongs to under
 * `resetPolicy`, resolving the date in `timeZone` (UTC when absent, #7). The
 * atomic allocation compares the stored key against this value (per issue date)
 * to decide whether to roll the sequence back to 1. `none` yields a constant
 * empty key so its counter never resets. Pure — no I/O.
 */
export function computePeriodKey(
  resetPolicy: ResetPolicy,
  issueDate: Date,
  timeZone?: string,
): string {
  const { year, month, day } = zonedParts(issueDate, timeZone);
  const yearStr = String(year).padStart(4, '0');
  switch (resetPolicy) {
    case 'none':
      return '';
    case 'yearly':
      return yearStr;
    case 'quarterly':
      return `${yearStr}-Q${quarterOf(month)}`;
    case 'monthly':
      return `${yearStr}-${pad2(month)}`;
    case 'daily':
      return `${yearStr}-${pad2(month)}-${pad2(day)}`;
  }
}
