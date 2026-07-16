/**
 * Numbering live-preview builder
 *
 * Turns a draft numbering pattern into the pieces the editor's live-preview
 * panel renders: a tokenised "next number" (so `{seq}` can paint in the accent
 * colour and date parts in a secondary tone), an ordered "then" strip of the
 * following numbers, the rendered length (for the length meter), and the
 * validation verdict. Pure — no I/O; delegates the rule to
 * {@link validateNumberingPattern} so the FE never re-implements the core rule
 * as a second source of truth.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import type { ResetPolicy } from '../api/numbering.types';
import { renderInvoiceNumber, validateNumberingPattern } from './numbering-pattern';

export type PreviewTokenKind = 'seq' | 'date' | 'literal';

export interface PreviewToken {
  text: string;
  kind: PreviewTokenKind;
}

export interface NumberingPreview {
  /** True when the pattern satisfies the reset policy and carries {seq}. */
  valid: boolean;
  /** Human-readable issues (empty when valid). */
  errors: string[];
  /** Tokenised next number; empty when invalid (panel renders a dash). */
  tokens: PreviewToken[];
  /** Rendered next number (joined tokens); empty when invalid. */
  rendered: string;
  /** Character length of the rendered next number (for the length meter). */
  renderedLength: number;
  /** Plain-rendered following numbers (the ghost "Then" strip). */
  then: string[];
}

const VARIABLE_RE = /(\{(?:seq|YYYY|YY|MM|QQ|DD|FY)\})/g;

function kindOf(token: string): PreviewTokenKind {
  if (token === '{seq}') return 'seq';
  return 'date';
}

/**
 * Tokenise one rendered number so the panel can style variable-derived spans
 * distinctly from literals. Splits the pattern on its variables, renders each
 * segment, and tags it.
 */
function tokenize(
  pattern: string,
  seq: number,
  seqPadding: number,
  issueDate: Date,
  timeZone?: string,
  fiscalYearStartMonth?: number,
): PreviewToken[] {
  const parts = pattern.split(VARIABLE_RE).filter((part) => part.length > 0);
  return parts.map((part) => {
    if (VARIABLE_RE.test(part)) {
      // `test` advances lastIndex on a global regex — reset so the next call is clean.
      VARIABLE_RE.lastIndex = 0;
      return {
        text: renderInvoiceNumber(part, {
          seq,
          seqPadding,
          issueDate,
          timeZone,
          fiscalYearStartMonth,
        }),
        kind: kindOf(part),
      };
    }
    return { text: part, kind: 'literal' as const };
  });
}

export interface BuildNumberingPreviewInput {
  pattern: string;
  nextSeq: number;
  seqPadding: number;
  resetPolicy: ResetPolicy;
  now: Date;
  /** IANA zone id; date parts resolve in this zone (UTC when absent). */
  timeZone?: string;
  /** Fiscal-year start month (1-12) governing {FY}; absent / 1 = calendar year. */
  fiscalYearStartMonth?: number;
  thenCount?: number;
}

export function buildNumberingPreview(input: BuildNumberingPreviewInput): NumberingPreview {
  const {
    pattern,
    nextSeq,
    seqPadding,
    resetPolicy,
    now,
    timeZone,
    fiscalYearStartMonth,
    thenCount = 3,
  } = input;
  const errors = validateNumberingPattern(pattern, resetPolicy);
  const seqValid = Number.isFinite(nextSeq) && nextSeq >= 1;
  const valid = errors.length === 0 && seqValid;

  if (!valid) {
    return { valid: false, errors, tokens: [], rendered: '', renderedLength: 0, then: [] };
  }

  const tokens = tokenize(pattern, nextSeq, seqPadding, now, timeZone, fiscalYearStartMonth);
  const rendered = tokens.map((token) => token.text).join('');
  const then: string[] = [];
  for (let i = 1; i <= thenCount; i += 1) {
    then.push(
      renderInvoiceNumber(pattern, {
        seq: nextSeq + i,
        seqPadding,
        issueDate: now,
        timeZone,
        fiscalYearStartMonth,
      }),
    );
  }
  return { valid: true, errors, tokens, rendered, renderedLength: rendered.length, then };
}
