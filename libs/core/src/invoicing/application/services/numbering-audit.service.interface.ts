/**
 * Numbering Audit Service Interface
 *
 * Contract for the numbering gap-audit read model (#8): for one numbering series,
 * derive the consumed sequence integers with their outcomes (issued / pending /
 * abandoned / skipped), flag the gaps, and join any recorded explanations - plus
 * record a neutral explanation for a gap. Pure/repository reads only; NO
 * allocation logic (numbers are never reused to fill a gap). Country-agnostic
 * (ADR-026): the explanation is a neutral free-text string.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type {
  NumberingGapNoteData,
  RecordNumberingGapNoteInput,
  SeriesAudit,
  SeriesAuditOptions,
} from '../../domain/types/numbering-audit.types';

export interface INumberingAuditService {
  /**
   * Build the gap-audit read model for a series. Throws
   * `InvoiceNumberingSeriesNotFoundException` when the id is unknown. Reads the
   * series' consumed sequences (from `InvoiceRecord.allocatedSeq`), classifies
   * each outcome, infers skipped integers for a non-resetting series only, and
   * attaches any recorded explanation to each gap.
   */
  getSeriesAudit(seriesId: string, opts?: SeriesAuditOptions): Promise<SeriesAudit>;

  /**
   * Record (upsert) a neutral explanation for a gap sequence. Delegates to the
   * gap-note repository; validates that `reason` is non-empty.
   */
  recordGapNote(input: RecordNumberingGapNoteInput): Promise<NumberingGapNoteData>;
}
