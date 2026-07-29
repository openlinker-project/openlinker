/**
 * Invoice Number Gap-Note Repository Port
 *
 * Persistence contract for the neutral numbering-gap explanations (#8). Minimal
 * surface: record (upsert) one explanation and list a series' explanations. The
 * audit read model joins these onto its gap entries.
 *
 * @module libs/core/src/invoicing/domain/ports
 */
import type {
  NumberingGapNoteData,
  RecordNumberingGapNoteInput,
} from '../types/numbering-audit.types';

export interface InvoiceNumberGapNoteRepositoryPort {
  /**
   * Record an explanation for a gap, upserted on `(seriesId, seq)` - re-explaining
   * a gap replaces the prior `reason` / `documentNumber` / `actorUserId`.
   */
  recordNote(input: RecordNumberingGapNoteInput): Promise<NumberingGapNoteData>;

  /** List every recorded explanation for a series (ascending by `seq`). */
  listBySeriesId(seriesId: string): Promise<NumberingGapNoteData[]>;
}
