/**
 * Invoice Number Pattern — pure renderer, validator, and period-key helpers
 *
 * Pure, framework-free functions (#1575) that turn a numbering-series pattern
 * into a concrete document number, validate a pattern against its reset policy,
 * and compute the opaque period key the atomic allocation compares to detect a
 * period rollover. Country-agnostic (ADR-026): positional variables only, no
 * provider/country vocabulary. Date variables resolve from the document issue
 * date in UTC so the rendered number and the period key never disagree across
 * timezones.
 *
 * Pattern variables (anything else is a literal):
 *   {seq}  — the allocated sequence number, zero-padded to `seqPadding`
 *   {YYYY} — 4-digit year        {YY} — 2-digit year
 *   {MM}   — 2-digit month 01–12 {QQ} — calendar quarter 1–4
 *
 * @module libs/core/src/invoicing/domain/numbering
 */
import type {
  NumberRenderContext,
  ResetPolicy,
} from '../types/invoice-numbering.types';
import { NumberingYearVariableValues } from '../types/invoice-numbering.types';
import { InvalidNumberingPatternException } from '../exceptions/invalid-numbering-pattern.exception';

const SEQ_VAR = '{seq}';
const MONTH_VAR = '{MM}';
const QUARTER_VAR = '{QQ}';

function utcYear(date: Date): number {
  return date.getUTCFullYear();
}

function utcMonth(date: Date): number {
  // getUTCMonth is 0-based; callers want the 1–12 calendar month.
  return date.getUTCMonth() + 1;
}

function utcQuarter(date: Date): number {
  return Math.floor(date.getUTCMonth() / 3) + 1;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Render a document number from a pattern. Unknown `{...}` tokens are left as
 * literals (the validator forbids them at create/update time, so a rendered
 * number never carries an unresolved token in practice). Pure — no I/O.
 */
export function renderInvoiceNumber(pattern: string, ctx: NumberRenderContext): string {
  const year = utcYear(ctx.issueDate);
  const replacements: Record<string, string> = {
    '{seq}': String(ctx.seq).padStart(Math.max(ctx.seqPadding, 0), '0'),
    '{YYYY}': String(year).padStart(4, '0'),
    '{YY}': pad2(year % 100),
    '{MM}': pad2(utcMonth(ctx.issueDate)),
    '{QQ}': String(utcQuarter(ctx.issueDate)),
  };
  return pattern.replace(/\{(seq|YYYY|YY|MM|QQ)\}/g, (token) => replacements[token] ?? token);
}

/**
 * Validate a pattern against a reset policy (#1575). Returns a flat list of
 * human-readable issues; empty means valid. Rules:
 *   - `{seq}` is required (a series with no sequence is meaningless).
 *   - the reset cadence must be disambiguated by the pattern, or a reset would
 *     re-render an already-issued number:
 *       monthly   → needs {MM} + a year variable
 *       quarterly → needs {QQ} + a year variable
 *       yearly    → needs a year variable
 *       none      → no additional requirement
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

  switch (resetPolicy) {
    case 'monthly':
      if (!hasMonth || !hasYear) {
        errors.push('A monthly reset policy requires the {MM} and a year ({YYYY} or {YY}) variable.');
      }
      break;
    case 'quarterly':
      if (!hasQuarter || !hasYear) {
        errors.push('A quarterly reset policy requires the {QQ} and a year ({YYYY} or {YY}) variable.');
      }
      break;
    case 'yearly':
      if (!hasYear) {
        errors.push('A yearly reset policy requires a year ({YYYY} or {YY}) variable.');
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
 * Compute the opaque period key a document issued on `issueDate` belongs to under
 * `resetPolicy`. The atomic allocation compares the stored key against this value
 * (per issue date) to decide whether to roll the sequence back to 1. `none`
 * yields a constant empty key so its counter never resets. Pure — no I/O.
 */
export function computePeriodKey(resetPolicy: ResetPolicy, issueDate: Date): string {
  const year = String(utcYear(issueDate)).padStart(4, '0');
  switch (resetPolicy) {
    case 'none':
      return '';
    case 'yearly':
      return year;
    case 'monthly':
      return `${year}-${pad2(utcMonth(issueDate))}`;
    case 'quarterly':
      return `${year}-Q${utcQuarter(issueDate)}`;
  }
}
