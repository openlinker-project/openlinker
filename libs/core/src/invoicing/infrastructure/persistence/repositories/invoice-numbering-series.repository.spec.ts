/**
 * InvoiceNumberingSeriesRepository — unit tests (#1575, #9, #10)
 *
 * Mocks the TypeORM `Repository` / `DataSource`. Covers ORM↔domain mapping and
 * the document-type routing resolution + register fallback. The single-query
 * `listUnassignedSeries` (LEFT JOIN via QueryBuilder, #13) and the atomic
 * `allocateNumber` (raw `UPDATE ... RETURNING` + transaction) are proven against
 * real Postgres in the concurrency integration test, not here.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/repositories
 */
import type { DataSource, Repository } from 'typeorm';

import { InvoiceNumberingSeries } from '../../../domain/entities/invoice-numbering-series.entity';
import { InvoiceNumberingSeriesNotFoundException } from '../../../domain/exceptions/invoice-numbering-series-not-found.exception';
import type { InvoiceNumberingRouteOrmEntity } from '../entities/invoice-numbering-route.orm-entity';
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
      documentType: 'invoice',
      register: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    overrides,
  );
  return entity;
}

describe('InvoiceNumberingSeriesRepository', () => {
  let seriesRepo: jest.Mocked<Repository<InvoiceNumberingSeriesOrmEntity>>;
  let routeRepo: jest.Mocked<Repository<InvoiceNumberingRouteOrmEntity>>;
  let dataSource: jest.Mocked<DataSource>;
  let repo: InvoiceNumberingSeriesRepository;

  beforeEach(() => {
    seriesRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<InvoiceNumberingSeriesOrmEntity>>;
    routeRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<Repository<InvoiceNumberingRouteOrmEntity>>;
    dataSource = {} as unknown as jest.Mocked<DataSource>;
    repo = new InvoiceNumberingSeriesRepository(seriesRepo, routeRepo, dataSource);
  });

  it('createSeries maps the persisted row (incl. documentType/register) to a domain entity', async () => {
    seriesRepo.save.mockResolvedValue(seriesRow({ documentType: 'corrected', register: 'PL' }));
    const result = await repo.createSeries({
      name: 'Main',
      pattern: 'FV/{seq}/{MM}/{YYYY}',
      nextSeq: 1,
      seqPadding: 4,
      resetPolicy: 'monthly',
      periodKey: '2026-06',
      documentType: 'corrected',
      register: 'PL',
    });
    expect(result).toBeInstanceOf(InvoiceNumberingSeries);
    expect(result.documentType).toBe('corrected');
    expect(result.register).toBe('PL');
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

  it('listUnassignedSeries runs a single LEFT JOIN query (#13)', async () => {
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([seriesRow({ id: 'series-3' })]),
    };
    seriesRepo.createQueryBuilder.mockReturnValue(qb as never);
    const result = await repo.listUnassignedSeries();
    expect(qb.where).toHaveBeenCalledWith('route.id IS NULL');
    expect(result.map((s) => s.id)).toEqual(['series-3']);
  });

  it('findSeriesIdForDocument returns the exact register route when present', async () => {
    routeRepo.findOne.mockResolvedValueOnce({
      seriesId: 'series-reg',
    } as InvoiceNumberingRouteOrmEntity);
    const result = await repo.findSeriesIdForDocument('conn-1', 'invoice', 'PL');
    expect(result).toBe('series-reg');
    expect(routeRepo.findOne).toHaveBeenCalledWith({
      where: { connectionId: 'conn-1', documentType: 'invoice', register: 'PL' },
    });
  });

  it('findSeriesIdForDocument falls back to the register-less default route', async () => {
    // No exact register route, then a register-less default hit.
    routeRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ seriesId: 'series-default' } as InvoiceNumberingRouteOrmEntity);
    const result = await repo.findSeriesIdForDocument('conn-1', 'invoice', 'PL');
    expect(result).toBe('series-default');
    // The fallback query keys on the register-less default (register → IsNull()).
    expect(routeRepo.findOne).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ connectionId: 'conn-1', documentType: 'invoice' }),
    });
  });

  it('findSeriesIdForDocument returns null when no route matches', async () => {
    routeRepo.findOne.mockResolvedValue(null);
    expect(await repo.findSeriesIdForDocument('conn-1', 'invoice', null)).toBeNull();
  });

  it('upsertRoute persists the seriesId under the routing key', async () => {
    routeRepo.findOne.mockResolvedValue(null);
    routeRepo.create.mockReturnValue({} as InvoiceNumberingRouteOrmEntity);
    routeRepo.save.mockResolvedValue({
      connectionId: 'conn-1',
      documentType: 'invoice',
      register: null,
      seriesId: 'series-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as InvoiceNumberingRouteOrmEntity);
    const result = await repo.upsertRoute({
      connectionId: 'conn-1',
      documentType: 'invoice',
      seriesId: 'series-1',
    });
    expect(result).toEqual(
      expect.objectContaining({ documentType: 'invoice', seriesId: 'series-1', register: null }),
    );
  });

  it('findRoutesByConnectionId maps route rows', async () => {
    routeRepo.find.mockResolvedValue([
      {
        connectionId: 'conn-1',
        documentType: 'corrected',
        register: null,
        seriesId: 'series-2',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as InvoiceNumberingRouteOrmEntity,
    ]);
    const result = await repo.findRoutesByConnectionId('conn-1');
    expect(result).toEqual([
      expect.objectContaining({ documentType: 'corrected', seriesId: 'series-2' }),
    ]);
  });
});
