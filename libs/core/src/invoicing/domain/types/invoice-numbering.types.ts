/**
 * Invoice Numbering Types
 *
 * Country-agnostic vocabulary for the invoice numbering-series aggregate (#1575).
 * A numbering series produces the legal, sequential document number OpenLinker
 * supplies to a `DocumentNumberConsumer` provider (today KSeF's FA(3) `P_2`).
 * Neutral by construction (ADR-026): a document number, a reset cadence, and a
 * pattern of positional variables — no provider/country vocabulary.
 *
 * @module libs/core/src/invoicing/domain/types
 */

/**
 * Reset cadence of a series' sequence counter. On a period change the atomic
 * allocation rolls `seq` back to 1 (see the numbering repository). `none` never
 * resets — one ever-growing sequence.
 */
export const ResetPolicyValues = ['none', 'monthly', 'quarterly', 'yearly'] as const;
export type ResetPolicy = (typeof ResetPolicyValues)[number];

/**
 * Pattern variables a series pattern may reference. Anything outside this set is
 * a literal. `{seq}` is the (zero-padded) sequence number; the rest resolve from
 * the document issue date. `{QQ}` is the calendar quarter (`1`–`4`).
 */
export const NumberingPatternVariableValues = [
  '{seq}',
  '{YYYY}',
  '{YY}',
  '{MM}',
  '{QQ}',
] as const;
export type NumberingPatternVariable = (typeof NumberingPatternVariableValues)[number];

/** Year-carrying variables — a reset policy's period must be disambiguated by one of these. */
export const NumberingYearVariableValues = ['{YYYY}', '{YY}'] as const;

/**
 * The numbering series aggregate (persisted). `nextSeq` is the NEXT sequence to
 * allocate; `periodKey` is the opaque marker of the period `nextSeq` currently
 * belongs to (empty string for `none`), compared inside the atomic allocation to
 * detect a period rollover. `seqPadding` zero-pads the rendered `{seq}` to that
 * width (0 = no padding).
 */
export interface InvoiceNumberingSeriesData {
  id: string;
  name: string;
  pattern: string;
  nextSeq: number;
  seqPadding: number;
  resetPolicy: ResetPolicy;
  periodKey: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Assignment linking a connection to its numbering series. `correctionSeriesId`
 * is optional — when absent, corrections draw from the main series. The
 * assignment is a detachable pointer: deleting a connection never cascade-deletes
 * the series it referenced (#1575).
 */
export interface SeriesAssignmentData {
  connectionId: string;
  mainSeriesId: string;
  correctionSeriesId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Persistence input for a new numbering series. `periodKey` is caller-computed (see `computePeriodKey`). */
export interface CreateInvoiceNumberingSeriesInput {
  name: string;
  pattern: string;
  nextSeq: number;
  seqPadding: number;
  resetPolicy: ResetPolicy;
  periodKey: string;
}

/**
 * Mutable subset of a series (C2 CRUD edits these). Numbers already assigned are
 * immutable; lowering `nextSeq` is permitted (a migration use case).
 */
export interface UpdateInvoiceNumberingSeriesInput {
  name?: string;
  pattern?: string;
  nextSeq?: number;
  seqPadding?: number;
  resetPolicy?: ResetPolicy;
  periodKey?: string;
}

/** Input to render one document number from a series' pattern. */
export interface NumberRenderContext {
  /** The allocated sequence number (pre-padding). */
  seq: number;
  /** Zero-pad width for `{seq}`; 0 = no padding. */
  seqPadding: number;
  /** Document issue date the date variables resolve from. */
  issueDate: Date;
}

/** Outcome of an atomic allocation against a series. */
export interface AllocatedNumber {
  /** The rendered document number persisted on the invoice record. */
  documentNumber: string;
  /** The sequence number that was allocated. */
  allocatedSeq: number;
}
