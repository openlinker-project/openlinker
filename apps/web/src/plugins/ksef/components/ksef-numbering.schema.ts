/**
 * KSeF numbering editor schema + prefills
 *
 * Zod schema for the single-series editor (create + edit share one form). A
 * series carries a neutral document type, an optional register/entity scope, a
 * pattern of positional variables, a reset cadence, padding, and the next
 * number. All numeric inputs stay strings on the form (browser number inputs
 * surface strings); the schema range-checks them in `superRefine` and the
 * `to*Input` mappers parse them for the API. The pattern rule is delegated to
 * `validateNumberingPattern` (the core mirror) so the FE never re-implements it.
 *
 * @module plugins/ksef/components
 */
import { z } from 'zod';
import {
  DocumentTypeValues,
  ResetPolicyValues,
  validateNumberingPattern,
  type CreateNumberingSeriesInput,
  type DocumentType,
  type NumberingSeries,
  type ResetPolicy,
  type UpdateNumberingSeriesInput,
} from '../../../features/invoicing';

const MAX_PADDING = 20;

function parseIntStrict(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Editor form values. `register` is a free-text scope; empty → the default. */
export interface NumberingFormValues {
  name: string;
  documentType: DocumentType;
  register: string;
  pattern: string;
  resetPolicy: ResetPolicy;
  seqPadding: string;
  nextSeq: string;
  /** Fiscal-year start month (1-12) as a form string; governs {FY}. */
  fiscalYearStartMonth: string;
}

export const numberingFormSchema = z
  .object({
    name: z.string(),
    documentType: z.enum(DocumentTypeValues),
    register: z.string(),
    pattern: z.string(),
    resetPolicy: z.enum(ResetPolicyValues),
    seqPadding: z.string(),
    nextSeq: z.string(),
    fiscalYearStartMonth: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.name.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Give the series a name.' });
    }
    for (const issue of validateNumberingPattern(values.pattern, values.resetPolicy)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pattern'], message: issue });
    }
    const padding = parseIntStrict(values.seqPadding);
    if (padding === null || padding > MAX_PADDING) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['seqPadding'],
        message: `Padding must be a whole number between 0 and ${MAX_PADDING}.`,
      });
    }
    const seq = parseIntStrict(values.nextSeq);
    if (seq === null || seq < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextSeq'],
        message: 'Next number must be a whole number of at least 1.',
      });
    }
    // Only relevant when the pattern uses {FY}; still range-checked defensively.
    const fyStart = parseIntStrict(values.fiscalYearStartMonth);
    if (fyStart === null || fyStart < 1 || fyStart > 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fiscalYearStartMonth'],
        message: 'Fiscal year start must be a month between 1 and 12.',
      });
    }
  });

/** Prefills for a brand-new series (a standard monthly VAT series). */
export const NUMBERING_CREATE_DEFAULTS: NumberingFormValues = {
  name: 'Sales invoices',
  documentType: 'invoice',
  register: '',
  pattern: 'FV/{seq}/{MM}/{YYYY}',
  resetPolicy: 'monthly',
  seqPadding: '0',
  nextSeq: '1',
  fiscalYearStartMonth: '1',
};

/** Seed the form from an existing series (edit mode). */
export function seriesToFormValues(series: NumberingSeries): NumberingFormValues {
  return {
    name: series.name,
    documentType: (DocumentTypeValues as readonly string[]).includes(series.documentType)
      ? (series.documentType as DocumentType)
      : 'invoice',
    register: series.register ?? '',
    pattern: series.pattern,
    resetPolicy: series.resetPolicy,
    seqPadding: String(series.seqPadding),
    nextSeq: String(series.nextSeq),
    fiscalYearStartMonth: String(series.fiscalYearStartMonth),
  };
}

function normalizeRegister(register: string): string | null {
  const trimmed = register.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toCreateInput(values: NumberingFormValues): CreateNumberingSeriesInput {
  return {
    name: values.name.trim(),
    documentType: values.documentType,
    register: normalizeRegister(values.register),
    pattern: values.pattern.trim(),
    resetPolicy: values.resetPolicy,
    seqPadding: Number(values.seqPadding),
    nextSeq: Number(values.nextSeq),
    fiscalYearStartMonth: Number(values.fiscalYearStartMonth),
  };
}

export function toUpdateInput(values: NumberingFormValues): UpdateNumberingSeriesInput {
  return {
    name: values.name.trim(),
    documentType: values.documentType,
    register: normalizeRegister(values.register),
    pattern: values.pattern.trim(),
    resetPolicy: values.resetPolicy,
    seqPadding: Number(values.seqPadding),
    nextSeq: Number(values.nextSeq),
    fiscalYearStartMonth: Number(values.fiscalYearStartMonth),
  };
}

/** Which form field a server-side pattern-coverage issue attaches to. */
export const SERVER_ISSUE_FIELD = 'pattern';
