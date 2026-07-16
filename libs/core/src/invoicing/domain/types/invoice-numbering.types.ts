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
 * the document issue date IN THE SELLER TIMEZONE. `{QQ}` is the calendar quarter
 * (`1`–`4`); `{DD}` is the 2-digit day of month; `{FY}` is the 4-digit fiscal
 * year — kept a DISTINCT token from `{YYYY}` so a future configurable
 * fiscal-year start (out of scope, #11) can diverge it from the calendar year.
 * For now `{FY}` renders the calendar year of the issue date.
 */
export const NumberingPatternVariableValues = [
  '{seq}',
  '{YYYY}',
  '{YY}',
  '{MM}',
  '{QQ}',
  '{DD}',
  '{FY}',
] as const;
export type NumberingPatternVariable = (typeof NumberingPatternVariableValues)[number];

/**
 * Year-carrying variables — a reset policy's period must be disambiguated by one
 * of these. `{FY}` counts as a year disambiguator (it equals the calendar year
 * today); if a configurable fiscal-year start ever diverges `{FY}` from the
 * calendar year, the yearly/monthly/quarterly period keys (calendar-based) would
 * need to move with it before `{FY}` alone can safely disambiguate a reset.
 */
export const NumberingYearVariableValues = ['{YYYY}', '{YY}', '{FY}'] as const;

/**
 * Neutral document-type routing defaults (#9). A regular issuance routes to the
 * connection's `invoice` series; a correction routes to its `corrected` series.
 * Both are well-known neutral {@link DocumentType} values (no provider/country
 * vocabulary) — they preserve the pre-#9 main/correction split as the default.
 */
export const DEFAULT_NUMBERING_DOCUMENT_TYPE = 'invoice';
export const CORRECTION_NUMBERING_DOCUMENT_TYPE = 'corrected';

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
  /**
   * Neutral document type this series numbers (#9) — e.g. `invoice` / `corrected`.
   * A well-known {@link DocumentType} value or any open-world string.
   */
  documentType: string;
  /**
   * Optional neutral register / entity-scope label (#10) segmenting a connection
   * into multiple parallel series for the same document type; `null` = the
   * register-less default series for that type.
   */
  register: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A document-type routing rule linking a connection to a numbering series (#9,
 * #10). Resolution key: `(connectionId, documentType, register)`. Replaces the
 * pre-#9 main/correction assignment split. The route is a detachable pointer:
 * deleting a connection never cascade-deletes the series it referenced, and the
 * series FK is `ON DELETE RESTRICT`.
 */
export interface SeriesRouteData {
  connectionId: string;
  documentType: string;
  register: string | null;
  seriesId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Create/replace input for a document-type routing rule. `register` absent = `null`. */
export interface UpsertSeriesRouteInput {
  connectionId: string;
  documentType: string;
  register?: string | null;
  seriesId: string;
}

/** Persistence input for a new numbering series. `periodKey` is caller-computed (see `computePeriodKey`). */
export interface CreateInvoiceNumberingSeriesInput {
  name: string;
  pattern: string;
  nextSeq: number;
  seqPadding: number;
  resetPolicy: ResetPolicy;
  periodKey: string;
  /** Neutral document type this series numbers (#9); defaults to `invoice` when omitted by the caller. */
  documentType: string;
  /** Optional neutral register/entity scope (#10); `null` = the type's register-less default. */
  register: string | null;
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
  documentType?: string;
  register?: string | null;
}

/**
 * Service-facing create input (#9/#10). Unlike {@link CreateInvoiceNumberingSeriesInput}
 * (the persistence contract) the caller does NOT supply `periodKey` — the
 * `INumberingSeriesService` seeds it from the reset policy — and `documentType`
 * is optional (defaults to {@link DEFAULT_NUMBERING_DOCUMENT_TYPE}).
 */
export interface CreateNumberingSeriesServiceInput {
  name: string;
  pattern: string;
  nextSeq: number;
  seqPadding: number;
  resetPolicy: ResetPolicy;
  documentType?: string;
  register?: string | null;
}

/**
 * Service-facing update patch (#9/#10): the mutable subset a caller may edit,
 * minus `periodKey` — the service re-seeds that itself on a reset-policy change.
 */
export type UpdateNumberingSeriesServiceInput = Omit<UpdateInvoiceNumberingSeriesInput, 'periodKey'>;

/**
 * Optional filter for {@link INumberingSeriesService.listSeries} (#10). An absent
 * field is not filtered on; `register: null` selects register-less default series.
 */
export interface ListNumberingSeriesFilter {
  documentType?: string;
  register?: string | null;
}

/** Input to render one document number from a series' pattern. */
export interface NumberRenderContext {
  /** The allocated sequence number (pre-padding). */
  seq: number;
  /** Zero-pad width for `{seq}`; 0 = no padding. */
  seqPadding: number;
  /** Document issue date the date variables resolve from. */
  issueDate: Date;
  /**
   * IANA timezone the date variables + fiscal year resolve in (#7). Absent =
   * UTC (a neutral fallback; the seller timezone is supplied by the provider
   * adapter, never hardcoded in core).
   */
  timeZone?: string;
}

/** Outcome of an atomic allocation against a series. */
export interface AllocatedNumber {
  /** The rendered document number persisted on the invoice record. */
  documentNumber: string;
  /** The sequence number that was allocated. */
  allocatedSeq: number;
}
