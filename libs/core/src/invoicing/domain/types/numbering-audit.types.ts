/**
 * Numbering Gap-Audit Types
 *
 * Country-agnostic vocabulary for the numbering gap-audit read model (#8). A
 * numbering series consumes a sequence integer for every document it allocates
 * (`InvoiceRecord.allocatedSeq`); a GAP is a consumed integer that is NOT carried
 * by a successfully issued document - either the record that consumed it ended
 * terminal-non-issued (`failed`, or a `rejected` regulatory outcome), or the
 * integer was skipped entirely (no record carries it). Numbers are NEVER reused
 * to fill a gap; the audit only surfaces gaps so the operator can file the
 * jurisdiction's written explanation (a FE/adapter concern - core stores a
 * neutral reason string, no `oświadczenie`/KSeF/FA vocabulary here per ADR-026).
 *
 * @module libs/core/src/invoicing/domain/types
 */

/**
 * Outcome of a single sequence integer within a series' audit.
 *
 *  - `issued`: a record consumed this integer and the document was successfully
 *    issued (issuance `issued`, regulatory clearance NOT `rejected`).
 *  - `pending`: a record consumed it but is still in-flight (`pending`/`issuing`)
 *    - not (yet) a gap; it may still complete or become abandoned.
 *  - `abandoned`: a record consumed it but ended terminal-non-issued (`failed`,
 *    or a `rejected` regulatory outcome). A GAP needing a written explanation.
 *  - `skipped`: NO record carries this integer inside the consumed range. A GAP
 *    (inferred only for a non-resetting series - see {@link SeriesAudit}).
 */
export const NumberingSeqStatusValues = ['issued', 'pending', 'abandoned', 'skipped'] as const;
export type NumberingSeqStatus = (typeof NumberingSeqStatusValues)[number];

/** True for the two sequence outcomes that constitute a gap. */
export function isGapSeqStatus(status: NumberingSeqStatus): boolean {
  return status === 'abandoned' || status === 'skipped';
}

/**
 * Neutral persisted explanation of a numbering gap (#8). Keyed by
 * `(seriesId, seq)`; `reason` is a free-text neutral string the operator supplies
 * (the jurisdiction's written-explanation label is a FE concern). `actorUserId`
 * records who explained it (`null` when unattributed).
 */
export interface NumberingGapNoteData {
  id: string;
  seriesId: string;
  /** The sequence integer this note explains. */
  seq: number;
  /** Rendered document number of the abandoned record, when known; `null` for a skipped integer. */
  documentNumber: string | null;
  /** Free-text neutral explanation for the gap. */
  reason: string;
  /** User who recorded the explanation; `null` when unattributed. */
  actorUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Persistence input to record (upsert) a gap explanation. `register` absent = unattributed. */
export interface RecordNumberingGapNoteInput {
  seriesId: string;
  seq: number;
  documentNumber?: string | null;
  reason: string;
  actorUserId?: string | null;
}

/**
 * One sequence integer in a series audit, with its resolved outcome and (for a
 * gap) any recorded explanation. `recordId`/`orderId`/`documentNumber`/timestamps
 * are `null` for a `skipped` integer (no record carries it).
 */
export interface SeriesAuditEntry {
  seq: number;
  status: NumberingSeqStatus;
  /** True when {@link status} is `abandoned` or `skipped`. */
  isGap: boolean;
  documentNumber: string | null;
  recordId: string | null;
  orderId: string | null;
  issuedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** The recorded explanation for this gap, when present; `null` otherwise. */
  note: NumberingGapNoteData | null;
}

/** Roll-up counts for a series audit. */
export interface SeriesAuditSummary {
  /** Successfully-issued sequence integers. */
  issuedCount: number;
  /** In-flight (pending/issuing) consumed integers - not yet a gap. */
  pendingCount: number;
  /** Consumed integers whose record ended terminal-non-issued. */
  abandonedCount: number;
  /** Integers with no record inside the consumed range (non-resetting series only). */
  skippedCount: number;
  /** Total gaps (`abandonedCount + skippedCount`). */
  gapCount: number;
  /** Gaps that carry a recorded explanation. */
  explainedGapCount: number;
}

/** The numbering audit read model for one series. */
export interface SeriesAudit {
  seriesId: string;
  seriesName: string;
  /**
   * Whether skipped-integer inference ran. Only a non-resetting series
   * (`resetPolicy === 'none'`) has a well-defined contiguous integer line, so
   * `skipped` entries are inferred ONLY there; for a resetting series the same
   * integer recurs across periods, so `skipped` inference is omitted and only
   * `abandoned` records are flagged as gaps.
   */
  skippedInferenceApplied: boolean;
  summary: SeriesAuditSummary;
  entries: SeriesAuditEntry[];
}

/** Options for {@link INumberingAuditService.getSeriesAudit}. */
export interface SeriesAuditOptions {
  /** When true, return only the gap entries (`abandoned`/`skipped`); default false. */
  onlyGaps?: boolean;
}
