/**
 * Numbering Gap-Audit Integration Test (#8)
 *
 * Proves the gap-audit read model + gap-note persistence against real Postgres:
 *  - `allocateNumber` persists the allocated sequence integer onto the invoice
 *    record (`allocatedSeq`) atomically with the rendered number;
 *  - `NumberingAuditService.getSeriesAudit` classifies each consumed sequence
 *    (issued / abandoned) and infers a skipped integer for a non-resetting
 *    series, flags the gaps, and joins a recorded explanation;
 *  - `recordGapNote` upserts on `(seriesId, seq)` (re-explaining replaces).
 *
 * @module apps/api/test/integration/invoicing
 */
import { NumberingAuditService } from '@openlinker/core/invoicing';
import {
  InvoiceNumberGapNoteOrmEntity,
  InvoiceNumberingRouteOrmEntity,
  InvoiceNumberingSeriesOrmEntity,
  InvoiceRecordOrmEntity,
} from '@openlinker/core/invoicing/orm-entities';
// Deep imports of the infrastructure repositories (host-only test seam), mirroring
// invoice-numbering-allocation.int-spec.ts.
import { InvoiceNumberGapNoteRepository } from '@openlinker/core/invoicing/infrastructure/persistence/repositories/invoice-number-gap-note.repository';
import { InvoiceNumberingSeriesRepository } from '@openlinker/core/invoicing/infrastructure/persistence/repositories/invoice-numbering-series.repository';
import { InvoiceRecordRepository } from '@openlinker/core/invoicing/infrastructure/persistence/repositories/invoice-record.repository';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  type IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

const CONNECTION_ID = '00000000-0000-0000-0000-000000000008';

describe('numbering gap-audit (integration)', () => {
  let harness: IntegrationTestHarness;
  let seriesRepo: Repository<InvoiceNumberingSeriesOrmEntity>;
  let recordRepo: Repository<InvoiceRecordOrmEntity>;
  let numberingRepo: InvoiceNumberingSeriesRepository;
  let audit: NumberingAuditService;
  let gapNoteRepo: InvoiceNumberGapNoteRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    const ds = harness.getDataSource();
    seriesRepo = ds.getRepository(InvoiceNumberingSeriesOrmEntity);
    recordRepo = ds.getRepository(InvoiceRecordOrmEntity);
    await ds.query(
      'TRUNCATE "invoice_number_gap_notes", "invoice_numbering_routes", "invoice_numbering_series" RESTART IDENTITY CASCADE',
    );
    numberingRepo = new InvoiceNumberingSeriesRepository(
      seriesRepo,
      ds.getRepository(InvoiceNumberingRouteOrmEntity),
      ds,
    );
    const recordRepository = new InvoiceRecordRepository(recordRepo);
    gapNoteRepo = new InvoiceNumberGapNoteRepository(ds.getRepository(InvoiceNumberGapNoteOrmEntity));
    audit = new NumberingAuditService(numberingRepo, recordRepository, gapNoteRepo);
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function createSeries(
    overrides: Partial<InvoiceNumberingSeriesOrmEntity> = {},
  ): Promise<InvoiceNumberingSeriesOrmEntity> {
    return seriesRepo.save(
      seriesRepo.create({
        name: 'Main',
        pattern: 'FV/{seq}',
        nextSeq: 1,
        seqPadding: 4,
        resetPolicy: 'none',
        periodKey: '',
        ...overrides,
      }),
    );
  }

  async function createRecord(
    orderId: string,
    overrides: Partial<InvoiceRecordOrmEntity> = {},
  ): Promise<InvoiceRecordOrmEntity> {
    return recordRepo.save(
      recordRepo.create({
        connectionId: CONNECTION_ID,
        orderId,
        providerType: 'ksef',
        documentType: 'invoice',
        status: 'pending',
        idempotencyKey: null,
        ...overrides,
      }),
    );
  }

  it('persists allocatedSeq on the record atomically with the rendered number', async () => {
    const series = await createSeries();
    const record = await createRecord('ol_order_seq_1');

    const result = await numberingRepo.allocateNumber({
      seriesId: series.id,
      recordId: record.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-06-15T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });

    expect(result.allocatedSeq).toBe(1);
    const persisted = await recordRepo.findOneByOrFail({ id: record.id });
    expect(persisted.allocatedSeq).toBe(1);
    expect(persisted.documentNumber).toBe('FV/0001');
  });

  it('classifies issued/abandoned, infers a skipped integer, and joins a recorded note', async () => {
    const series = await createSeries();

    // seq 1 issued.
    const issued = await createRecord('ol_order_ok');
    await numberingRepo.allocateNumber({
      seriesId: series.id,
      recordId: issued.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-06-15T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });
    await recordRepo.update({ id: issued.id }, { status: 'issued' });

    // seq 2 abandoned (failed).
    const failed = await createRecord('ol_order_bad');
    await numberingRepo.allocateNumber({
      seriesId: series.id,
      recordId: failed.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-06-15T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });
    await recordRepo.update({ id: failed.id }, { status: 'failed', failureMode: 'rejected' });

    // seq 3 skipped: burn the integer by rolling nextSeq forward without a record.
    await seriesRepo.update({ id: series.id }, { nextSeq: 4 });

    // seq 4 issued.
    const issued2 = await createRecord('ol_order_ok2');
    await numberingRepo.allocateNumber({
      seriesId: series.id,
      recordId: issued2.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-06-15T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });
    await recordRepo.update({ id: issued2.id }, { status: 'issued' });

    // Explain the skipped gap at seq 3.
    await audit.recordGapNote({
      seriesId: series.id,
      seq: 3,
      reason: 'Counter advanced during a migration; number never issued.',
      actorUserId: null,
    });

    const result = await audit.getSeriesAudit(series.id);

    expect(result.skippedInferenceApplied).toBe(true);
    expect(result.entries.map((e) => [e.seq, e.status])).toEqual([
      [1, 'issued'],
      [2, 'abandoned'],
      [3, 'skipped'],
      [4, 'issued'],
    ]);
    expect(result.summary).toEqual({
      issuedCount: 2,
      pendingCount: 0,
      abandonedCount: 1,
      skippedCount: 1,
      gapCount: 2,
      explainedGapCount: 1,
    });
    const skipped = result.entries.find((e) => e.seq === 3);
    expect(skipped?.note?.reason).toContain('migration');
  });

  it('upserts a gap note on (seriesId, seq) — re-explaining replaces the reason', async () => {
    const series = await createSeries();

    const first = await gapNoteRepo.recordNote({
      seriesId: series.id,
      seq: 2,
      reason: 'First reason',
    });
    const second = await gapNoteRepo.recordNote({
      seriesId: series.id,
      seq: 2,
      reason: 'Corrected reason',
    });

    expect(second.id).toBe(first.id);
    const notes = await gapNoteRepo.listBySeriesId(series.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].reason).toBe('Corrected reason');
  });
});
