/**
 * Mirakl Import Types
 *
 * Mirakl applies offer, stock, price and product writes asynchronously: the
 * submit call answers with an import id, and the outcome is read later from a
 * status endpoint and an error report. The four kinds differ in id format,
 * status path and report format (measured on Empik staging, SPIKE-4268 § 2.2),
 * which `MiraklImportTracker` hides behind these neutral shapes.
 *
 * @module libs/integrations/mirakl/src/domain/types
 */

/** OF24/OF01 offers, STO01 stock, PRI01 prices, P41 products. */
export const MiraklImportKindValues = ['offers', 'stock', 'prices', 'products'] as const;
export type MiraklImportKind = (typeof MiraklImportKindValues)[number];

/**
 * Where an import stands.
 *
 * - `pending`: Mirakl is still processing it, or reported a status this build
 *   does not recognise (never read as finished).
 * - `awaiting-operator`: a product import Mirakl has transformed and handed to
 *   the operator, who has not integrated it into the catalogue yet. On Empik
 *   staging this lasted indefinitely (import 30532), so it is reported apart
 *   from `pending`.
 * - `done`: Mirakl finished reading the file. Lines may still have failed:
 *   read `linesInError`, never the state alone.
 * - `failed`: the whole import failed or was cancelled.
 */
export const MiraklImportStateValues = ['pending', 'awaiting-operator', 'done', 'failed'] as const;
export type MiraklImportState = (typeof MiraklImportStateValues)[number];

export interface MiraklImportStatus {
  readonly kind: MiraklImportKind;
  readonly importId: string;
  readonly state: MiraklImportState;
  /** Mirakl's own status string, verbatim, for logs and support tickets. */
  readonly rawStatus: string | null;
  /** Count of lines that failed. `undefined` when Mirakl reported none. */
  readonly linesInError?: number;
  readonly linesInSuccess?: number;
  readonly linesRead?: number;
  /** Whether Mirakl has an error report for this import. */
  readonly hasErrorReport: boolean;
  /**
   * A product import only: whether Mirakl has a transformation error report
   * (P47), the lines it could not read before the operator saw them.
   */
  readonly hasTransformationErrorReport?: boolean;
}

/** One failed line from an import's error report. */
export interface MiraklImportLineError {
  /** Line number in the submitted file, when the report states one. */
  readonly line?: number;
  /** Offer or product SKU the line was about, when the report states one. */
  readonly sku?: string;
  /** Mirakl's reason, verbatim. */
  readonly reason: string;
}
