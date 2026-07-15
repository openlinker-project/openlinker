/**
 * Invoice numbering pattern — pure renderer + validator (FE mirror of C1)
 *
 * Client-side copies of the C1 domain helpers (`renderInvoiceNumber`,
 * `validateNumberingPattern`) so the numbering editor can render a live
 * preview and surface validation without a round-trip. The API/domain stays
 * the source of truth (#1577): these functions exist for UX only and are kept
 * byte-for-byte behaviourally aligned with
 * `libs/core/src/invoicing/domain/numbering/invoice-number-pattern.ts`. Date
 * variables resolve in UTC to match the server so preview and issued number
 * never disagree across timezones.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import type { ResetPolicy } from '../api/numbering.types';

const SEQ_VAR = '{seq}';
const MONTH_VAR = '{MM}';
const QUARTER_VAR = '{QQ}';
const YEAR_VARS = ['{YYYY}', '{YY}'] as const;

function utcYear(date: Date): number {
  return date.getUTCFullYear();
}

function utcMonth(date: Date): number {
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
 * literals. Pure — no I/O.
 */
export function renderInvoiceNumber(
  pattern: string,
  ctx: { seq: number; seqPadding: number; issueDate: Date },
): string {
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
 * Validate a pattern against a reset policy (#1577 UX mirror of the C1 rule).
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

  switch (resetPolicy) {
    case 'monthly':
      if (!hasMonth || !hasYear) {
        errors.push(
          'Monthly reset needs {MM} and a year ({YYYY} or {YY}) in the pattern, or numbers repeat.',
        );
      }
      break;
    case 'quarterly':
      if (!hasQuarter || !hasYear) {
        errors.push(
          'Quarterly reset needs {QQ} and a year ({YYYY} or {YY}) in the pattern, or numbers repeat.',
        );
      }
      break;
    case 'yearly':
      if (!hasYear) {
        errors.push('Yearly reset needs a year ({YYYY} or {YY}) in the pattern, or numbers repeat.');
      }
      break;
    case 'none':
      break;
  }
  return errors;
}
