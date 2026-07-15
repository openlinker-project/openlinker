/**
 * InvoiceNumberingSeriesRepository — unit tests (#1575)
 *
 * Mocks the TypeORM `Repository` / `DataSource`. Covers ORM↔domain mapping and
 * the assignment/orphan-listing logic. The atomic `allocateNumber` (raw
 * `UPDATE ... RETURNING` + transaction) is proven against real Postgres in the
 * concurrency integration test, not here.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/repositories
 */
import type { DataSource, Repository } from 'typeorm';

import { InvoiceNumberingSeries } from '../../../domain/entities/invoice-numbering-series.entity';
import { InvoiceNumberingSeriesNotFoundException } from '../../../domain/exceptions/invoice-numbering-series-not-found.exception';
import type { InvoiceNumberingAssignmentOrmEntity } from '../entities/invoice-numbering-assignment.orm-entity';
import { InvoiceNumberingSeriesOrmEntity } from '../entities/invoice-numbering-series.orm-entity';
import { InvoiceNumberingSeriesRepository } from './invoice-numbering-series.repository';

function seriesRow(overrides: Partial<InvoiceNumberingSeriesOrmEntity> = {}): InvoiceNumberingSeriesOrmEntity {
  const entity = new InvoiceNumberingSeriesOrmEntity();
  Object.assign(
    entity,
    {
      id: 'series-1',
      name: 'Main',
      pattern: 'FV/{seq}/{MM}/{YYYY}',
      nextSeq: 1,
      seqPadding: 4,
      resetPolicy: 'monthly',
      periodKey: '2026-06',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    overrides,
  );
  return entity;
}

describe('InvoiceNumberingSeriesRepository', () => {
  let seriesRepo: jest.Mocked<Repository<InvoiceNumberingSeriesOrmEntity>>;
  let assignmentRepo: jest.Mocked<Repository<InvoiceNumberingAssignmentOrmEntity>>;
  let dataSource: jest.Mocked<DataSource>;
  let repo: InvoiceNumberingSeriesRepository;

  beforeEach(() => {
    seriesRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<InvoiceNumberingSeriesOrmEntity>>;
    assignmentRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<InvoiceNumberingAssignmentOrmEntity>>;
    dataSource = {} as unknown as jest.Mocked<DataSource>;
    repo = new InvoiceNumberingSeriesRepository(seriesRepo, assignmentRepo, dataSource);
  });

  it('createSeries maps the persisted row to a domain entity', async () => {
    seriesRepo.save.mockResolvedValue(seriesRow());
    const result = await repo.createSeries({
      name: 'Main',
      pattern: 'FV/{seq}/{MM}/{YYYY}',
      nextSeq: 1,
      seqPadding: 4,
      resetPolicy: 'monthly',
      periodKey: '2026-06',
    });
    expect(result).toBeInstanceOf(InvoiceNumberingSeries);
    expect(result.pattern).toBe('FV/{seq}/{MM}/{YYYY}');
    expect(result.resetPolicy).toBe('monthly');
    expect(result.periodKey).toBe('2026-06');
  });

  it('findSeriesById returns null when the row is absent', async () => {
    seriesRepo.findOne.mockResolvedValue(null);
    expect(await repo.findSeriesById('nope')).toBeNull();
  });

  it('updateSeries throws when the series does not exist', async () => {
    seriesRepo.findOne.mockResolvedValue(null);
    await expect(repo.updateSeries('nope', { nextSeq: 5 })).rejects.toBeInstanceOf(
      InvoiceNumberingSeriesNotFoundException,
    );
  });

  it('listUnassignedSeries excludes series referenced by any assignment (main or correction)', async () => {
    assignmentRepo.find.mockResolvedValue([
      {
        connectionId: 'conn-1',
        mainSeriesId: 'series-1',
        correctionSeriesId: 'series-2',
      } as InvoiceNumberingAssignmentOrmEntity,
    ]);
    seriesRepo.find.mockResolvedValue([
      seriesRow({ id: 'series-1' }),
      seriesRow({ id: 'series-2' }),
      seriesRow({ id: 'series-3' }),
    ]);
    const result = await repo.listUnassignedSeries();
    expect(result.map((s) => s.id)).toEqual(['series-3']);
  });

  it('findAssignmentByConnectionId maps the row', async () => {
    assignmentRepo.findOne.mockResolvedValue({
      connectionId: 'conn-1',
      mainSeriesId: 'series-1',
      correctionSeriesId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as InvoiceNumberingAssignmentOrmEntity);
    const result = await repo.findAssignmentByConnectionId('conn-1');
    expect(result).toEqual(
      expect.objectContaining({ mainSeriesId: 'series-1', correctionSeriesId: null }),
    );
  });
});
