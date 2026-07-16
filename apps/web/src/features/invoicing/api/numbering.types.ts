/**
 * Invoice numbering — transport types (binds the numbering-series HTTP API)
 *
 * FE mirror of the numbering HTTP contract. Neutral vocabulary (ADR-026): a
 * series is a pattern of positional variables + a reset cadence, scoped to a
 * neutral `documentType` and an optional `register`; a route is a detachable
 * pointer from a connection's `(documentType, register)` to a series. The
 * gap-audit read model surfaces per-sequence outcomes so an operator can record
 * a written explanation for a numbering gap.
 *
 * @module apps/web/src/features/invoicing/api
 */

// The neutral document-type vocabulary is shared with the invoice-issue surface;
// reuse the single definition rather than mirroring it twice in the feature.
export { DocumentTypeValues } from './invoicing.types';
export type { DocumentType } from './invoicing.types';
import type { DocumentType } from './invoicing.types';

/** Reset cadence of a series' sequence counter (mirrors core `ResetPolicy`). */
export const ResetPolicyValues = ['none', 'daily', 'monthly', 'quarterly', 'yearly'] as const;
export type ResetPolicy = (typeof ResetPolicyValues)[number];

/** Resolved outcome of one sequence integer in the gap-audit read model. */
export const NumberingSeqStatusValues = ['issued', 'pending', 'abandoned', 'skipped'] as const;
export type NumberingSeqStatus = (typeof NumberingSeqStatusValues)[number];

/**
 * Pattern variables a series pattern may reference; anything else is literal.
 * Ordered as rendered in the chip row ({FY} sits next to the year variables).
 */
export const NumberingPatternVariableValues = [
  '{seq}',
  '{YYYY}',
  '{YY}',
  '{FY}',
  '{MM}',
  '{QQ}',
  '{DD}',
] as const;
export type NumberingPatternVariable = (typeof NumberingPatternVariableValues)[number];

/** A numbering series (server response shape). */
export interface NumberingSeries {
  id: string;
  name: string;
  pattern: string;
  nextSeq: number;
  seqPadding: number;
  resetPolicy: ResetPolicy;
  documentType: string;
  register: string | null;
  /** Calendar month (1-12) the fiscal year starts on, governing {FY}; 1 = calendar year. */
  fiscalYearStartMonth: number;
  periodKey: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An unassigned (unrouted) series, augmented with its last-issued number so a
 * picker can show what the series has already produced.
 */
export interface UnassignedNumberingSeries extends NumberingSeries {
  lastIssuedSeq: number | null;
  lastIssuedNumberPreview: string | null;
}

/** A connection's document-type numbering route. */
export interface NumberingRoute {
  connectionId: string;
  documentType: string;
  register: string | null;
  seriesId: string;
  createdAt: string;
  updatedAt: string;
}

/** Filter for `GET /invoicing/numbering-series`. */
export interface ListNumberingSeriesFilter {
  documentType?: string;
  register?: string;
}

/** `POST /invoicing/numbering-series` body. */
export interface CreateNumberingSeriesInput {
  name: string;
  pattern: string;
  nextSeq: number;
  seqPadding: number;
  resetPolicy: ResetPolicy;
  documentType: DocumentType;
  register?: string | null;
  /** Fiscal-year start month (1-12) governing {FY}; omitted = 1 (calendar year). */
  fiscalYearStartMonth?: number;
}

/** `PATCH /invoicing/numbering-series/:id` body — all fields optional. */
export interface UpdateNumberingSeriesInput {
  name?: string;
  pattern?: string;
  nextSeq?: number;
  seqPadding?: number;
  resetPolicy?: ResetPolicy;
  documentType?: DocumentType;
  register?: string | null;
  /** Fiscal-year start month (1-12) governing {FY}; 1 = calendar year. */
  fiscalYearStartMonth?: number;
}

/** `PUT /invoicing/connections/:id/numbering-routes` body. */
export interface UpsertNumberingRouteInput {
  documentType: DocumentType;
  register?: string | null;
  seriesId: string;
}

/** `DELETE /invoicing/connections/:id/numbering-routes` body. */
export interface DeleteNumberingRouteInput {
  documentType: DocumentType;
  register?: string | null;
}

/** A recorded neutral explanation for a numbering gap. */
export interface NumberingGapNote {
  id: string;
  seriesId: string;
  seq: number;
  documentNumber: string | null;
  reason: string;
  actorUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `POST /invoicing/numbering-series/:id/gap-notes` body. */
export interface RecordGapNoteInput {
  seq: number;
  documentNumber?: string | null;
  reason: string;
}

/** One sequence integer's outcome in the gap-audit read model. */
export interface SeriesAuditEntry {
  seq: number;
  status: NumberingSeqStatus;
  isGap: boolean;
  documentNumber: string | null;
  recordId: string | null;
  orderId: string | null;
  issuedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  note: NumberingGapNote | null;
}

/** Roll-up counts for a series' gap-audit. */
export interface SeriesAuditSummary {
  issuedCount: number;
  pendingCount: number;
  abandonedCount: number;
  skippedCount: number;
  gapCount: number;
  explainedGapCount: number;
}

/** The gap-audit read model for one series. */
export interface SeriesAudit {
  seriesId: string;
  seriesName: string;
  skippedInferenceApplied: boolean;
  summary: SeriesAuditSummary;
  entries: SeriesAuditEntry[];
}
