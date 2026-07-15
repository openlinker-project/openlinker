/**
 * Invoice numbering — transport types (#1577, binds C2 #1576)
 *
 * FE mirror of the C2 numbering-series HTTP contract. Neutral vocabulary
 * (ADR-026): a series is a pattern of positional variables + a reset cadence;
 * an assignment is a detachable pointer from a connection to its main +
 * optional correction series.
 *
 * @module apps/web/src/features/invoicing/api
 */

/** Reset cadence of a series' sequence counter (mirrors C1 `ResetPolicy`). */
export const ResetPolicyValues = ['none', 'monthly', 'quarterly', 'yearly'] as const;
export type ResetPolicy = (typeof ResetPolicyValues)[number];

/** Pattern variables a series pattern may reference; anything else is literal. */
export const NumberingPatternVariableValues = ['{seq}', '{YYYY}', '{YY}', '{MM}', '{QQ}'] as const;
export type NumberingPatternVariable = (typeof NumberingPatternVariableValues)[number];

/** A numbering series (server response shape). */
export interface NumberingSeries {
  id: string;
  name: string;
  pattern: string;
  nextSeq: number;
  seqPadding: number;
  resetPolicy: ResetPolicy;
  periodKey: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An unassigned (orphaned) series, augmented with its last-issued number so the
 * re-attach list can show what the series has already produced.
 */
export interface UnassignedNumberingSeries extends NumberingSeries {
  lastIssuedSeq: number | null;
  lastIssuedNumberPreview: string | null;
}

/** A connection → series assignment (main + optional correction). */
export interface NumberingAssignment {
  connectionId: string;
  mainSeriesId: string;
  correctionSeriesId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `POST /invoicing/numbering-series` body. */
export interface CreateNumberingSeriesInput {
  name: string;
  pattern: string;
  nextSeq: number;
  seqPadding: number;
  resetPolicy: ResetPolicy;
}

/** `PATCH /invoicing/numbering-series/:id` body — all fields optional. */
export interface UpdateNumberingSeriesInput {
  name?: string;
  pattern?: string;
  nextSeq?: number;
  seqPadding?: number;
  resetPolicy?: ResetPolicy;
}

/** `PUT /invoicing/connections/:id/numbering-assignment` body. */
export interface SetNumberingAssignmentInput {
  mainSeriesId: string;
  correctionSeriesId?: string | null;
}
