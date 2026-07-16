/**
 * Numbering Audit Service
 *
 * Read model for numbering gap-audit (#8). For one series it reads the consumed
 * sequence integers (`InvoiceRecord.allocatedSeq`), classifies each outcome, and
 * flags the gaps a numbering series accumulates when a consumed number is not
 * carried by a successfully issued document:
 *
 *   - `abandoned` - a record consumed the integer but ended terminal-non-issued
 *     (issuance `failed`, or a `rejected` regulatory outcome). The number is
 *     burned; it is never reused to fill the gap.
 *   - `skipped` - no record carries the integer inside the consumed range of its
 *     reset PERIOD. Consumed integers are bucketed by reset period (via
 *     `computePeriodKey` on each record's issue/allocation date, honouring the
 *     series `resetPolicy`); within one period the sequence is contiguous, so
 *     holes are inferable per-period for every reset policy - monthly, quarterly,
 *     yearly, and the degenerate single-period `none`.
 *
 * Each gap is joined to its recorded explanation (if any). Pure/repository reads
 * only - no allocation. Country-agnostic (ADR-026): the explanation is a neutral
 * free-text string.
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {INumberingAuditService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { InvoiceNumberingSeriesNotFoundException } from '../../domain/exceptions/invoice-numbering-series-not-found.exception';
import { NumberingGapNoteReasonRequiredException } from '../../domain/exceptions/numbering-gap-note-reason-required.exception';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import { computePeriodKey } from '../../domain/numbering/invoice-number-pattern';
import type { ResetPolicy } from '../../domain/types/invoice-numbering.types';
// Value imports (not `import type`): these ports are injected via @Inject and
// surface in the constructor's decorator metadata.
import { InvoiceNumberGapNoteRepositoryPort } from '../../domain/ports/invoice-number-gap-note-repository.port';
import { InvoiceNumberingSeriesRepositoryPort } from '../../domain/ports/invoice-numbering-series-repository.port';
import { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type {
  NumberingGapNoteData,
  NumberingSeqStatus,
  RecordNumberingGapNoteInput,
  SeriesAudit,
  SeriesAuditEntry,
  SeriesAuditOptions,
  SeriesAuditSummary,
} from '../../domain/types/numbering-audit.types';
import { isGapSeqStatus } from '../../domain/types/numbering-audit.types';
import {
  INVOICE_NUMBER_GAP_NOTE_REPOSITORY_TOKEN,
  INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN,
  INVOICE_RECORD_REPOSITORY_TOKEN,
} from '../../invoicing.tokens';
import type { INumberingAuditService } from './numbering-audit.service.interface';

@Injectable()
export class NumberingAuditService implements INumberingAuditService {
  constructor(
    @Inject(INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN)
    private readonly seriesRepo: InvoiceNumberingSeriesRepositoryPort,
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly recordRepo: InvoiceRecordRepositoryPort,
    @Inject(INVOICE_NUMBER_GAP_NOTE_REPOSITORY_TOKEN)
    private readonly gapNoteRepo: InvoiceNumberGapNoteRepositoryPort,
  ) {}

  async getSeriesAudit(seriesId: string, opts?: SeriesAuditOptions): Promise<SeriesAudit> {
    const series = await this.seriesRepo.findSeriesById(seriesId);
    if (!series) {
      throw new InvoiceNumberingSeriesNotFoundException(seriesId);
    }

    const [records, notes] = await Promise.all([
      this.recordRepo.findBySeriesId(seriesId),
      this.gapNoteRepo.listBySeriesId(seriesId),
    ]);
    const notesBySeq = new Map<number, NumberingGapNoteData>(notes.map((n) => [n.seq, n]));

    // Within a single reset period the sequence is contiguous, so skipped
    // integers are inferable per-period for every reset policy (`none` is the
    // degenerate single-period case). See {@link buildEntries}.
    const skippedInferenceApplied = true;

    const entries = this.buildEntries(records, notesBySeq, series.resetPolicy);
    const summary = this.summarize(entries);
    const visible = opts?.onlyGaps ? entries.filter((e) => e.isGap) : entries;

    return {
      seriesId: series.id,
      seriesName: series.name,
      skippedInferenceApplied,
      summary,
      entries: visible,
    };
  }

  async recordGapNote(input: RecordNumberingGapNoteInput): Promise<NumberingGapNoteData> {
    if (input.reason.trim().length === 0) {
      throw new NumberingGapNoteReasonRequiredException(input.seriesId, input.seq);
    }
    return this.gapNoteRepo.recordNote({ ...input, reason: input.reason.trim() });
  }

  /**
   * Build one entry per consumed sequence (from the records), then fill the
   * integer holes between the min and max consumed seq of EACH reset period as
   * `skipped`. Consumed entries are bucketed by reset period (derived from each
   * record's issue/allocation date via {@link computePeriodKey}, honouring the
   * series `resetPolicy`); within one period the sequence is contiguous, so the
   * min..max hole-fill is a genuine skipped-integer detection - for a resetting
   * series (monthly/quarterly/yearly) as well as the single-period `none`. The
   * range starts at the lowest allocated integer per period (never asserting
   * 1..min-1 are skipped, since a period may open above its reset floor). Numbers
   * are never reused; this read model only surfaces the holes. Entries are
   * returned ordered by (period ascending, seq ascending) - `periodKey` strings
   * sort chronologically for every cadence.
   */
  private buildEntries(
    records: InvoiceRecord[],
    notesBySeq: Map<number, NumberingGapNoteData>,
    resetPolicy: ResetPolicy,
  ): SeriesAuditEntry[] {
    // periodKey -> (seq -> entry). The audit has no seller timezone, so periods
    // are bucketed in UTC (computePeriodKey's neutral fallback). This matches the
    // allocation's period except for an issuance within a few hours of a period
    // boundary - an acceptable approximation for a read-only gap audit.
    const buckets = new Map<string, Map<number, SeriesAuditEntry>>();
    for (const record of records) {
      if (record.allocatedSeq === null) {
        continue;
      }
      const periodKey = computePeriodKey(resetPolicy, record.issuedAt ?? record.createdAt);
      const bySeq = buckets.get(periodKey) ?? new Map<number, SeriesAuditEntry>();
      buckets.set(periodKey, bySeq);
      const status = this.classify(record);
      // A consumed seq should be unique per (series, period) - the atomic
      // allocation burns each integer once. If a duplicate ever appears, prefer
      // the issued row so a re-numbered retry doesn't mask a real success.
      const existing = bySeq.get(record.allocatedSeq);
      if (existing && existing.status === 'issued') {
        continue;
      }
      bySeq.set(
        record.allocatedSeq,
        this.toEntry(record.allocatedSeq, periodKey, status, record, notesBySeq),
      );
    }

    for (const [periodKey, bySeq] of buckets) {
      if (bySeq.size === 0) {
        continue;
      }
      const consumed = [...bySeq.keys()];
      const min = Math.min(...consumed);
      const max = Math.max(...consumed);
      for (let seq = min; seq <= max; seq++) {
        if (!bySeq.has(seq)) {
          bySeq.set(seq, this.toSkippedEntry(seq, periodKey, notesBySeq));
        }
      }
    }

    return [...buckets.values()]
      .flatMap((bySeq) => [...bySeq.values()])
      .sort((a, b) => {
        const pa = a.periodKey ?? '';
        const pb = b.periodKey ?? '';
        if (pa !== pb) {
          return pa < pb ? -1 : 1;
        }
        return a.seq - b.seq;
      });
  }

  /** Terminal-non-issued (failed / regulatory-rejected) burns the number; in-flight stays pending. */
  private classify(record: InvoiceRecord): NumberingSeqStatus {
    if (record.status === 'failed' || record.regulatoryStatus === 'rejected') {
      return 'abandoned';
    }
    if (record.status === 'issued') {
      return 'issued';
    }
    return 'pending';
  }

  private toEntry(
    seq: number,
    periodKey: string,
    status: NumberingSeqStatus,
    record: InvoiceRecord,
    notesBySeq: Map<number, NumberingGapNoteData>,
  ): SeriesAuditEntry {
    const isGap = isGapSeqStatus(status);
    return {
      seq,
      periodKey,
      status,
      isGap,
      documentNumber: record.documentNumber,
      recordId: record.id,
      orderId: record.orderId,
      issuedAt: record.issuedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      note: isGap ? notesBySeq.get(seq) ?? null : null,
    };
  }

  private toSkippedEntry(
    seq: number,
    periodKey: string,
    notesBySeq: Map<number, NumberingGapNoteData>,
  ): SeriesAuditEntry {
    return {
      seq,
      periodKey,
      status: 'skipped',
      isGap: true,
      documentNumber: null,
      recordId: null,
      orderId: null,
      issuedAt: null,
      createdAt: null,
      updatedAt: null,
      note: notesBySeq.get(seq) ?? null,
    };
  }

  private summarize(entries: SeriesAuditEntry[]): SeriesAuditSummary {
    let issuedCount = 0;
    let pendingCount = 0;
    let abandonedCount = 0;
    let skippedCount = 0;
    let explainedGapCount = 0;
    for (const entry of entries) {
      switch (entry.status) {
        case 'issued':
          issuedCount++;
          break;
        case 'pending':
          pendingCount++;
          break;
        case 'abandoned':
          abandonedCount++;
          break;
        case 'skipped':
          skippedCount++;
          break;
      }
      if (entry.isGap && entry.note !== null) {
        explainedGapCount++;
      }
    }
    return {
      issuedCount,
      pendingCount,
      abandonedCount,
      skippedCount,
      gapCount: abandonedCount + skippedCount,
      explainedGapCount,
    };
  }
}
