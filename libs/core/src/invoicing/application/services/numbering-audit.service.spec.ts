/**
 * Numbering Audit Service — unit specs (#8)
 *
 * Covers gap classification (issued / pending / abandoned / skipped), per-reset-
 * period skipped-integer inference (none / yearly / monthly buckets), note
 * joining + summary counts, the `onlyGaps` filter, empty-reason rejection, and
 * not-found.
 *
 * @module libs/core/src/invoicing/application/services
 */
import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import { InvoiceNumberingSeries } from '../../domain/entities/invoice-numbering-series.entity';
import { InvoiceNumberingSeriesNotFoundException } from '../../domain/exceptions/invoice-numbering-series-not-found.exception';
import { NumberingGapNoteReasonRequiredException } from '../../domain/exceptions/numbering-gap-note-reason-required.exception';
import type { InvoiceNumberGapNoteRepositoryPort } from '../../domain/ports/invoice-number-gap-note-repository.port';
import type { InvoiceNumberingSeriesRepositoryPort } from '../../domain/ports/invoice-numbering-series-repository.port';
import type { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type { InvoiceStatus, RegulatoryStatus } from '../../domain/types/invoicing.types';
import type { ResetPolicy } from '../../domain/types/invoice-numbering.types';
import { NumberingAuditService } from './numbering-audit.service';

function makeSeries(overrides: Partial<{ id: string; name: string; resetPolicy: ResetPolicy }> = {}): InvoiceNumberingSeries {
  return new InvoiceNumberingSeries(
    overrides.id ?? 'series-1',
    overrides.name ?? 'Main',
    'FV/{seq}/{YYYY}',
    10,
    3,
    overrides.resetPolicy ?? 'none',
    '',
    'invoice',
    null,
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T00:00:00Z'),
  );
}

function makeRecord(
  seq: number,
  status: InvoiceStatus,
  regulatoryStatus: RegulatoryStatus = 'not-applicable',
  // The record's issue/allocation date - governs which reset period it buckets
  // into. Defaults to a fixed Jan-2026 instant so single-period tests are stable.
  periodDate: Date = new Date('2026-01-05T09:00:00Z'),
): InvoiceRecord {
  return new InvoiceRecord(
    `rec-${seq}`,
    'conn-1',
    `ol_order_${seq}`,
    'ksef',
    'invoice',
    status,
    null,
    null,
    regulatoryStatus,
    null,
    null,
    null,
    status === 'issued' ? periodDate : null,
    null,
    periodDate,
    periodDate,
    null,
    null,
    null,
    null,
    false,
    null,
    null,
    null,
    'unknown',
    'series-1',
    `FV/${String(seq).padStart(3, '0')}/2026`,
    seq,
  );
}

describe('NumberingAuditService', () => {
  let seriesRepo: jest.Mocked<InvoiceNumberingSeriesRepositoryPort>;
  let recordRepo: jest.Mocked<InvoiceRecordRepositoryPort>;
  let gapNoteRepo: jest.Mocked<InvoiceNumberGapNoteRepositoryPort>;
  let service: NumberingAuditService;

  beforeEach(() => {
    seriesRepo = {
      findSeriesById: jest.fn(),
    } as unknown as jest.Mocked<InvoiceNumberingSeriesRepositoryPort>;
    recordRepo = {
      findBySeriesId: jest.fn(),
    } as unknown as jest.Mocked<InvoiceRecordRepositoryPort>;
    gapNoteRepo = {
      recordNote: jest.fn(),
      listBySeriesId: jest.fn(),
    } as unknown as jest.Mocked<InvoiceNumberGapNoteRepositoryPort>;
    service = new NumberingAuditService(seriesRepo, recordRepo, gapNoteRepo);
  });

  describe('getSeriesAudit', () => {
    it('should throw when the series does not exist', async () => {
      seriesRepo.findSeriesById.mockResolvedValue(null);
      await expect(service.getSeriesAudit('missing')).rejects.toBeInstanceOf(
        InvoiceNumberingSeriesNotFoundException,
      );
    });

    it('should classify issued, abandoned (failed + rejected) and infer skipped for a non-resetting series', async () => {
      seriesRepo.findSeriesById.mockResolvedValue(makeSeries({ resetPolicy: 'none' }));
      // seq 10 issued, 11 failed, 13 issued but regulatory-rejected; 12 skipped (no record).
      recordRepo.findBySeriesId.mockResolvedValue([
        makeRecord(10, 'issued'),
        makeRecord(11, 'failed'),
        makeRecord(13, 'issued', 'rejected'),
      ]);
      gapNoteRepo.listBySeriesId.mockResolvedValue([]);

      const audit = await service.getSeriesAudit('series-1');

      expect(audit.skippedInferenceApplied).toBe(true);
      expect(audit.entries.map((e) => [e.seq, e.status])).toEqual([
        [10, 'issued'],
        [11, 'abandoned'],
        [12, 'skipped'],
        [13, 'abandoned'],
      ]);
      expect(audit.summary).toEqual({
        issuedCount: 1,
        pendingCount: 0,
        abandonedCount: 2,
        skippedCount: 1,
        gapCount: 3,
        explainedGapCount: 0,
      });
    });

    it('should infer skipped integers per period for a yearly resetting series', async () => {
      seriesRepo.findSeriesById.mockResolvedValue(makeSeries({ resetPolicy: 'yearly' }));
      // 2024 period: seq 1 + 3 issued -> 2 skipped. 2025 period: seq 1 + 2 issued
      // -> no hole. The same seq recurs across periods; each is bucketed apart.
      recordRepo.findBySeriesId.mockResolvedValue([
        makeRecord(1, 'issued', 'not-applicable', new Date('2024-03-01T09:00:00Z')),
        makeRecord(3, 'issued', 'not-applicable', new Date('2024-09-01T09:00:00Z')),
        makeRecord(1, 'issued', 'not-applicable', new Date('2025-02-01T09:00:00Z')),
        makeRecord(2, 'issued', 'not-applicable', new Date('2025-06-01T09:00:00Z')),
      ]);
      gapNoteRepo.listBySeriesId.mockResolvedValue([]);

      const audit = await service.getSeriesAudit('series-1');

      expect(audit.skippedInferenceApplied).toBe(true);
      // Ordered by (period asc, seq asc); the 2024 hole at seq 2 is inferred.
      expect(audit.entries.map((e) => [e.periodKey, e.seq, e.status])).toEqual([
        ['2024', 1, 'issued'],
        ['2024', 2, 'skipped'],
        ['2024', 3, 'issued'],
        ['2025', 1, 'issued'],
        ['2025', 2, 'issued'],
      ]);
      expect(audit.summary.skippedCount).toBe(1);
      expect(audit.summary.gapCount).toBe(1);
      expect(audit.summary.issuedCount).toBe(4);
    });

    it('should infer skipped integers per period for a monthly resetting series', async () => {
      seriesRepo.findSeriesById.mockResolvedValue(makeSeries({ resetPolicy: 'monthly' }));
      // 2026-01: seq 1 issued, seq 2 failed (abandoned) -> no skipped hole.
      // 2026-02: seq 1 issued, seq 3 issued -> seq 2 skipped.
      recordRepo.findBySeriesId.mockResolvedValue([
        makeRecord(1, 'issued', 'not-applicable', new Date('2026-01-10T09:00:00Z')),
        makeRecord(2, 'failed', 'not-applicable', new Date('2026-01-11T09:00:00Z')),
        makeRecord(1, 'issued', 'not-applicable', new Date('2026-02-05T09:00:00Z')),
        makeRecord(3, 'issued', 'not-applicable', new Date('2026-02-20T09:00:00Z')),
      ]);
      gapNoteRepo.listBySeriesId.mockResolvedValue([]);

      const audit = await service.getSeriesAudit('series-1');

      expect(audit.skippedInferenceApplied).toBe(true);
      expect(audit.entries.map((e) => [e.periodKey, e.seq, e.status])).toEqual([
        ['2026-01', 1, 'issued'],
        ['2026-01', 2, 'abandoned'],
        ['2026-02', 1, 'issued'],
        ['2026-02', 2, 'skipped'],
        ['2026-02', 3, 'issued'],
      ]);
      expect(audit.summary).toEqual({
        issuedCount: 3,
        pendingCount: 0,
        abandonedCount: 1,
        skippedCount: 1,
        gapCount: 2,
        explainedGapCount: 0,
      });
    });

    it('should treat pending/issuing records as non-gap pending', async () => {
      seriesRepo.findSeriesById.mockResolvedValue(makeSeries());
      recordRepo.findBySeriesId.mockResolvedValue([
        makeRecord(10, 'pending'),
        makeRecord(11, 'issuing'),
      ]);
      gapNoteRepo.listBySeriesId.mockResolvedValue([]);

      const audit = await service.getSeriesAudit('series-1');

      expect(audit.summary.pendingCount).toBe(2);
      expect(audit.summary.gapCount).toBe(0);
      expect(audit.entries.every((e) => !e.isGap)).toBe(true);
    });

    it('should attach a recorded note to its gap and count it explained; onlyGaps filters', async () => {
      seriesRepo.findSeriesById.mockResolvedValue(makeSeries({ resetPolicy: 'none' }));
      recordRepo.findBySeriesId.mockResolvedValue([
        makeRecord(10, 'issued'),
        makeRecord(11, 'failed'),
      ]);
      gapNoteRepo.listBySeriesId.mockResolvedValue([
        {
          id: 'note-1',
          seriesId: 'series-1',
          seq: 11,
          documentNumber: 'FV/011/2026',
          reason: 'Buyer tax id invalid; number abandoned.',
          actorUserId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const audit = await service.getSeriesAudit('series-1', { onlyGaps: true });

      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0].seq).toBe(11);
      expect(audit.entries[0].note?.reason).toContain('Buyer tax id');
      expect(audit.summary.explainedGapCount).toBe(1);
    });
  });

  describe('recordGapNote', () => {
    it('should reject a blank reason', async () => {
      await expect(
        service.recordGapNote({ seriesId: 'series-1', seq: 11, reason: '   ' }),
      ).rejects.toBeInstanceOf(NumberingGapNoteReasonRequiredException);
      expect(gapNoteRepo.recordNote).not.toHaveBeenCalled();
    });

    it('should trim and delegate to the repository', async () => {
      const persisted = {
        id: 'note-1',
        seriesId: 'series-1',
        seq: 11,
        documentNumber: null,
        reason: 'Abandoned',
        actorUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      gapNoteRepo.recordNote.mockResolvedValue(persisted);

      const result = await service.recordGapNote({
        seriesId: 'series-1',
        seq: 11,
        reason: '  Abandoned  ',
      });

      expect(gapNoteRepo.recordNote).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: 'series-1', seq: 11, reason: 'Abandoned' }),
      );
      expect(result).toBe(persisted);
    });
  });
});
