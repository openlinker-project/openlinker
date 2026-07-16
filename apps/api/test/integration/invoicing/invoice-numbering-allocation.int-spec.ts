/**
 * Invoice Numbering Allocation Integration Test (#1575)
 *
 * Proves the atomic `allocateNumber` primitive against real Postgres — the
 * fiscal guarantee that underwrites *"concurrent issuances against one series
 * never produce a duplicate number"*. The unit test can only run the raw
 * `UPDATE ... RETURNING` against a mocked driver; here we prove on real Postgres:
 *  - N parallel allocations against ONE series yield N DISTINCT sequential
 *    numbers and advance `nextSeq` exactly N times (no lost/duplicate sequence);
 *  - a period rollover (monthly) resets the sequence to 1 inside the same
 *    atomic statement;
 *  - a `nextSeq` rollback that re-renders an already-issued number is rejected
 *    by the unique index as a `DuplicateDocumentNumberException`.
 *
 * @module apps/api/test/integration/invoicing
 */
import {
  InvoiceNumberingRouteOrmEntity,
  InvoiceNumberingSeriesOrmEntity,
  InvoiceRecordOrmEntity,
} from '@openlinker/core/invoicing/orm-entities';
import { DuplicateDocumentNumberException } from '@openlinker/core/invoicing';
// Deep import of the infrastructure repository (host-only test seam), mirroring
// invoice-record-repository.int-spec.ts.
import { InvoiceNumberingSeriesRepository } from '@openlinker/core/invoicing/infrastructure/persistence/repositories/invoice-numbering-series.repository';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  type IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

const CONNECTION_ID = '00000000-0000-0000-0000-000000001575';

describe('invoice numbering allocation (integration)', () => {
  let harness: IntegrationTestHarness;
  let repo: InvoiceNumberingSeriesRepository;
  let seriesRepo: Repository<InvoiceNumberingSeriesOrmEntity>;
  let recordRepo: Repository<InvoiceRecordOrmEntity>;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    const ds = harness.getDataSource();
    seriesRepo = ds.getRepository(InvoiceNumberingSeriesOrmEntity);
    recordRepo = ds.getRepository(InvoiceRecordOrmEntity);
    await ds.query(
      'TRUNCATE "invoice_numbering_routes", "invoice_numbering_series" RESTART IDENTITY CASCADE',
    );
    repo = new InvoiceNumberingSeriesRepository(
      seriesRepo,
      ds.getRepository(InvoiceNumberingRouteOrmEntity),
      ds,
    );
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

  async function createRecord(orderId: string): Promise<InvoiceRecordOrmEntity> {
    return recordRepo.save(
      recordRepo.create({
        connectionId: CONNECTION_ID,
        orderId,
        providerType: 'ksef',
        documentType: 'invoice',
        status: 'pending',
        idempotencyKey: null,
      }),
    );
  }

  it('never produces a duplicate number under concurrent allocation against one series', async () => {
    const series = await createSeries();
    const n = 25;
    const records = await Promise.all(
      Array.from({ length: n }, (_v, i) => createRecord(`ol_order_conc_${i}`)),
    );

    const results = await Promise.all(
      records.map((r) =>
        repo.allocateNumber({
          seriesId: series.id,
          recordId: r.id,
          connectionId: CONNECTION_ID,
          issueDate: new Date('2026-06-15T10:00:00.000Z'),
          timeZone: 'Europe/Warsaw',
        }),
      ),
    );

    const numbers = results.map((r) => r.documentNumber);
    // All distinct — the fiscal guarantee.
    expect(new Set(numbers).size).toBe(n);
    // The set is exactly FV/0001 .. FV/00025 (contiguous, no gaps).
    const expected = Array.from({ length: n }, (_v, i) => `FV/${String(i + 1).padStart(4, '0')}`);
    expect([...numbers].sort()).toEqual([...expected].sort());

    // The series advanced exactly N times.
    const after = await seriesRepo.findOneByOrFail({ id: series.id });
    expect(after.nextSeq).toBe(n + 1);

    // Every record carries its allocated number.
    const persisted = await recordRepo.findBy({ connectionId: CONNECTION_ID });
    expect(persisted.every((p) => p.documentNumber !== null)).toBe(true);
    expect(new Set(persisted.map((p) => p.documentNumber)).size).toBe(n);
  });

  it('resets the sequence to 1 on a monthly period rollover inside the atomic statement', async () => {
    const series = await createSeries({
      pattern: 'FV/{seq}/{MM}/{YYYY}',
      resetPolicy: 'monthly',
      nextSeq: 7,
      periodKey: '2026-06',
    });
    const juneRecord = await createRecord('ol_order_june');
    const julyRecord = await createRecord('ol_order_july');

    const june = await repo.allocateNumber({
      seriesId: series.id,
      recordId: juneRecord.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-06-30T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });
    const july = await repo.allocateNumber({
      seriesId: series.id,
      recordId: julyRecord.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-07-01T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });

    // June kept the configured sequence; July rolled back to 1.
    expect(june.documentNumber).toBe('FV/0007/06/2026');
    expect(july.documentNumber).toBe('FV/0001/07/2026');
    const after = await seriesRepo.findOneByOrFail({ id: series.id });
    expect(after.periodKey).toBe('2026-07');
    expect(after.nextSeq).toBe(2);
  });

  it('resets the sequence to 1 on a daily period rollover inside the atomic statement (#1692)', async () => {
    const series = await createSeries({
      pattern: 'FV/{seq}/{DD}/{MM}/{YYYY}',
      resetPolicy: 'daily',
      nextSeq: 5,
      periodKey: '2026-06-30',
    });
    const day1Record = await createRecord('ol_order_day1');
    const day2Record = await createRecord('ol_order_day2');

    const day1 = await repo.allocateNumber({
      seriesId: series.id,
      recordId: day1Record.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-06-30T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });
    const day2 = await repo.allocateNumber({
      seriesId: series.id,
      recordId: day2Record.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-07-01T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });

    expect(day1.documentNumber).toBe('FV/0005/30/06/2026');
    expect(day2.documentNumber).toBe('FV/0001/01/07/2026');
    const after = await seriesRepo.findOneByOrFail({ id: series.id });
    expect(after.periodKey).toBe('2026-07-01');
    expect(after.nextSeq).toBe(2);
  });

  it('renders {FY} from a non-January fiscalYearStartMonth (#1692)', async () => {
    // Fiscal year starts in July; a June 2026 issue belongs to the fiscal year
    // that started July 2025 → {FY} label 2025.
    const series = await createSeries({
      pattern: 'FV/{seq}/{FY}',
      resetPolicy: 'none',
      fiscalYearStartMonth: 7,
    });
    const record = await createRecord('ol_order_fy');
    const result = await repo.allocateNumber({
      seriesId: series.id,
      recordId: record.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-06-15T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });
    expect(result.documentNumber).toBe('FV/0001/2025');
  });

  it('rejects a re-rendered number (nextSeq rollback) with DuplicateDocumentNumberException', async () => {
    const series = await createSeries();
    const first = await createRecord('ol_order_dup_1');
    const second = await createRecord('ol_order_dup_2');

    const firstResult = await repo.allocateNumber({
      seriesId: series.id,
      recordId: first.id,
      connectionId: CONNECTION_ID,
      issueDate: new Date('2026-06-15T10:00:00.000Z'),
      timeZone: 'Europe/Warsaw',
    });
    expect(firstResult.documentNumber).toBe('FV/0001');

    // Operator rolls the counter back so the next allocation re-renders FV/0001.
    await seriesRepo.update({ id: series.id }, { nextSeq: 1 });

    await expect(
      repo.allocateNumber({
        seriesId: series.id,
        recordId: second.id,
        connectionId: CONNECTION_ID,
        issueDate: new Date('2026-06-15T10:00:00.000Z'),
        timeZone: 'Europe/Warsaw',
      }),
    ).rejects.toBeInstanceOf(DuplicateDocumentNumberException);
  });
});
