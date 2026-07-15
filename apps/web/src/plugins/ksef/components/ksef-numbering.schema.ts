/**
 * KSeF numbering editor schema + prefills (#1577)
 *
 * Zod schema for the numbering editor. Two entry shapes share one form:
 *   - setup (new): the main series + a correction toggle that reveals a second
 *     prefilled series; submit creates both series then assigns them.
 *   - edit (existing): a single series' fields (the correction toggle is hidden;
 *     whether a connection keeps a separate correction series is an assignment
 *     concern edited from the resting view).
 *
 * All numeric inputs stay strings on the form (browser number inputs surface
 * strings); the schema validates their range in `superRefine` and the
 * `to*Input` mappers parse them for the API. The pattern rule is delegated to
 * `validateNumberingPattern` (the C1 mirror) so the FE never re-implements it.
 *
 * @module plugins/ksef/components
 */
import { z } from 'zod';
import { validateNumberingPattern } from '../../../features/invoicing';
import {
  ResetPolicyValues,
  type CreateNumberingSeriesInput,
  type ResetPolicy,
  type UpdateNumberingSeriesInput,
} from '../../../features/invoicing';

/** Editable pattern variables, surfaced as clickable chips in the editor. */
export const NUMBERING_VARIABLE_CHIPS = ['{seq}', '{YYYY}', '{YY}', '{MM}', '{QQ}'] as const;

export const RESET_POLICY_LABELS: Record<ResetPolicy, string> = {
  none: 'Never',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const MAX_PADDING = 20;

function parseIntStrict(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * Editor form values. `correction*` fields are only meaningful in setup mode
 * (when `correctionEnabled` is true); edit mode leaves the toggle off.
 */
export interface NumberingFormValues {
  name: string;
  pattern: string;
  resetPolicy: ResetPolicy;
  seqPadding: string;
  nextSeq: string;
  correctionEnabled: boolean;
  correctionName: string;
  correctionPattern: string;
  correctionResetPolicy: ResetPolicy;
  correctionSeqPadding: string;
  correctionNextSeq: string;
}

function refineSeries(
  ctx: z.RefinementCtx,
  prefix: '' | 'correction',
  name: string,
  pattern: string,
  resetPolicy: ResetPolicy,
  seqPadding: string,
  nextSeq: string,
): void {
  const path = (field: string): string =>
    prefix === '' ? field : `${prefix}${field.charAt(0).toUpperCase()}${field.slice(1)}`;

  if (name.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path('name')], message: 'Give the series a name.' });
  }
  for (const issue of validateNumberingPattern(pattern, resetPolicy)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path('pattern')], message: issue });
  }
  const padding = parseIntStrict(seqPadding);
  if (padding === null || padding > MAX_PADDING) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path('seqPadding')],
      message: `Padding must be a whole number between 0 and ${MAX_PADDING}.`,
    });
  }
  const seq = parseIntStrict(nextSeq);
  if (seq === null || seq < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path('nextSeq')],
      message: 'Next number must be a whole number of at least 1.',
    });
  }
}

export const numberingFormSchema = z
  .object({
    name: z.string(),
    pattern: z.string(),
    resetPolicy: z.enum(ResetPolicyValues),
    seqPadding: z.string(),
    nextSeq: z.string(),
    correctionEnabled: z.boolean(),
    correctionName: z.string(),
    correctionPattern: z.string(),
    correctionResetPolicy: z.enum(ResetPolicyValues),
    correctionSeqPadding: z.string(),
    correctionNextSeq: z.string(),
  })
  .superRefine((values, ctx) => {
    refineSeries(ctx, '', values.name, values.pattern, values.resetPolicy, values.seqPadding, values.nextSeq);
    if (values.correctionEnabled) {
      refineSeries(
        ctx,
        'correction',
        values.correctionName,
        values.correctionPattern,
        values.correctionResetPolicy,
        values.correctionSeqPadding,
        values.correctionNextSeq,
      );
    }
  });

/** Prefills for a brand-new setup (main FV monthly; correction FK on by default). */
export const NUMBERING_SETUP_DEFAULTS: NumberingFormValues = {
  name: 'Main invoices',
  pattern: 'FV/{seq}/{MM}/{YYYY}',
  resetPolicy: 'monthly',
  seqPadding: '0',
  nextSeq: '1',
  correctionEnabled: true,
  correctionName: 'Corrections',
  correctionPattern: 'FK/{seq}/{MM}/{YYYY}',
  correctionResetPolicy: 'monthly',
  correctionSeqPadding: '0',
  correctionNextSeq: '1',
};

/** Seed the form from an existing series (edit mode). */
export function seriesToFormValues(series: {
  name: string;
  pattern: string;
  resetPolicy: ResetPolicy;
  seqPadding: number;
  nextSeq: number;
}): NumberingFormValues {
  return {
    ...NUMBERING_SETUP_DEFAULTS,
    name: series.name,
    pattern: series.pattern,
    resetPolicy: series.resetPolicy,
    seqPadding: String(series.seqPadding),
    nextSeq: String(series.nextSeq),
    correctionEnabled: false,
  };
}

export function toMainCreateInput(values: NumberingFormValues): CreateNumberingSeriesInput {
  return {
    name: values.name.trim(),
    pattern: values.pattern.trim(),
    resetPolicy: values.resetPolicy,
    seqPadding: Number(values.seqPadding),
    nextSeq: Number(values.nextSeq),
  };
}

export function toCorrectionCreateInput(values: NumberingFormValues): CreateNumberingSeriesInput {
  return {
    name: values.correctionName.trim(),
    pattern: values.correctionPattern.trim(),
    resetPolicy: values.correctionResetPolicy,
    seqPadding: Number(values.correctionSeqPadding),
    nextSeq: Number(values.correctionNextSeq),
  };
}

export function toSeriesUpdateInput(values: NumberingFormValues): UpdateNumberingSeriesInput {
  return {
    name: values.name.trim(),
    pattern: values.pattern.trim(),
    resetPolicy: values.resetPolicy,
    seqPadding: Number(values.seqPadding),
    nextSeq: Number(values.nextSeq),
  };
}
