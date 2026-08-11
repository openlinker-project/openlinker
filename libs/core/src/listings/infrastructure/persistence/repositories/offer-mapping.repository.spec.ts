/**
 * Offer Mapping Repository — Unit Tests
 *
 * Verifies read operations, domain mapping, and invalid-UUID error translation.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';

import { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

import { OfferMappingRepository } from './offer-mapping.repository';

describe('OfferMappingRepository', () => {
  let repository: OfferMappingRepository;
  let ormRepository: jest.Mocked<Repository<IdentifierMappingOrmEntity>>;

  const now = new Date('2026-04-20T10:00:00Z');

  const buildOrm = (
    overrides: Partial<IdentifierMappingOrmEntity> = {}
  ): IdentifierMappingOrmEntity => ({
    id: 'mapping-uuid',
    entityType: 'Offer',
    internalId: 'ol_variant_123',
    externalId: 'allegro-offer-1',
    platformType: 'allegro',
    connectionId: 'conn-uuid',
    context: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<IdentifierMappingOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferMappingRepository,
        {
          provide: getRepositoryToken(IdentifierMappingOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<OfferMappingRepository>(OfferMappingRepository);
    ormRepository = module.get(getRepositoryToken(IdentifierMappingOrmEntity));
  });

  describe('findById', () => {
    it('should return the mapped domain entity when found', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.findById('mapping-uuid');

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'mapping-uuid', entityType: 'Offer' },
      });
      expect(result).toBeInstanceOf(IdentifierMapping);
      expect(result?.id).toBe('mapping-uuid');
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('missing');

      expect(result).toBeNull();
    });

    it('should return null when the driver raises a 22P02 QueryFailedError (invalid UUID)', async () => {
      const error = new QueryFailedError('invalid input syntax for type uuid', [], '');
      (error as QueryFailedError & { code?: string }).code = '22P02';
      ormRepository.findOne.mockRejectedValue(error);

      const result = await repository.findById('not-a-uuid');

      expect(result).toBeNull();
    });

    it('should re-throw a QueryFailedError with a different code', async () => {
      const error = new QueryFailedError('duplicate key value', [], '');
      (error as QueryFailedError & { code?: string }).code = '23505';
      ormRepository.findOne.mockRejectedValue(error);

      await expect(repository.findById('mapping-uuid')).rejects.toBe(error);
    });
  });

  describe('findMany (#2025)', () => {
    type ListQb = {
      leftJoin: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      select: jest.Mock;
      addSelect: jest.Mock;
      orderBy: jest.Mock;
      addOrderBy: jest.Mock;
      offset: jest.Mock;
      limit: jest.Mock;
      getCount: jest.Mock;
      getRawMany: jest.Mock;
    };

    const buildRawRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'mapping-uuid',
      entityType: 'Offer',
      internalId: 'ol_variant_123',
      externalId: 'allegro-offer-1',
      platformType: 'allegro',
      connectionId: 'conn-uuid',
      context: null,
      createdAt: now,
      updatedAt: now,
      productId: 'ol_product_1',
      productName: 'Doniczka ceramiczna Terra',
      productImages: ['https://cdn.example/terra-1.jpg', 'https://cdn.example/terra-2.jpg'],
      variantSku: 'TERRA-24-LIM',
      variantEan: '5900000000138',
      variantAttributes: { Kolor: 'Limonka', Rozmiar: '24 cm' },
      publicationStatus: 'active',
      statusDetails: null,
      lastStatusSyncedAt: now,
      commercialPrice: '100.00',
      commercialCurrency: 'PLN',
      commercialAvailableQuantity: 41,
      lastCommercialSyncedAt: now,
      ...overrides,
    });

    type AndWhereCall = [string, { search?: string } | undefined];

    /** The `andWhere` call carrying the search term, if one was emitted. */
    function findSearchCall(qb: ListQb): AndWhereCall | undefined {
      const calls = qb.andWhere.mock.calls as AndWhereCall[];
      return calls.find((call) => call[1]?.search !== undefined);
    }

    function buildListQb(rows: Array<Record<string, unknown>>, total = rows.length): ListQb {
      const qb: ListQb = {
        leftJoin: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        select: jest.fn(),
        addSelect: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        offset: jest.fn(),
        limit: jest.fn(),
        getCount: jest.fn().mockResolvedValue(total),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      for (const key of Object.keys(qb) as Array<keyof ListQb>) {
        if (key !== 'getCount' && key !== 'getRawMany') {
          qb[key].mockReturnValue(qb);
        }
      }
      return qb;
    }

    it('should join the products context and both snapshot tables by table name', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({}, { limit: 20, offset: 0 });

      expect(qb.leftJoin).toHaveBeenCalledWith(
        'product_variants',
        'pv',
        'pv."id" = mapping."internalId"'
      );
      expect(qb.leftJoin).toHaveBeenCalledWith('products', 'p', 'p."id" = pv."productId"');
      expect(qb.leftJoin).toHaveBeenCalledWith(
        'offer_status_snapshots',
        'oss',
        'oss."externalOfferId" = mapping."externalId" AND oss."connectionId" = mapping."connectionId"'
      );
      expect(qb.leftJoin).toHaveBeenCalledWith(
        'offer_commercial_snapshots',
        'ocs',
        'ocs."externalOfferId" = mapping."externalId" AND ocs."connectionId" = mapping."connectionId"'
      );
      // A single page is one query builder run - never an N+1 enrichment loop.
      expect(qb.getRawMany).toHaveBeenCalledTimes(1);
    });

    it('should widen search across product name, variant attributes, SKU, EAN and externalId', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({ search: 'terra' }, { limit: 20, offset: 0 });

      const searchCall = findSearchCall(qb);
      expect(searchCall).toBeDefined();
      const [clause, params] = searchCall as [string, { search: string }];

      expect(clause).toContain('mapping."externalId" ILIKE :search');
      expect(clause).toContain('p."name" ILIKE :search');
      expect(clause).toContain('pv."sku" ILIKE :search');
      expect(clause).toContain('pv."ean" ILIKE :search');
      // Attribute VALUES only - a plain `attributes::text` would also match keys.
      expect(clause).toContain('jsonb_each_text(pv."attributes")');
      expect(clause).toContain('attr.value ILIKE :search');
      expect(params).toEqual({ search: '%terra%' });
    });

    it('should escape ILIKE wildcards in the search term', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({ search: '50%_off' }, { limit: 20, offset: 0 });

      expect((findSearchCall(qb) as [string, { search: string }])[1]).toEqual({
        search: '%50\\%\\_off%',
      });
    });

    it('should not emit a search predicate when no term was supplied', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({ connectionId: 'conn-uuid' }, { limit: 20, offset: 0 });

      expect(findSearchCall(qb)).toBeUndefined();
    });

    it('should project identity, derived lifecycle and commercial data onto each item', async () => {
      const qb = buildListQb([buildRawRow()], 1);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.items[0].externalId).toBe('allegro-offer-1');
      expect(result.items[0].identity).toEqual({
        productId: 'ol_product_1',
        productName: 'Doniczka ceramiczna Terra',
        variantLabel: 'Limonka · 24 cm',
        sku: 'TERRA-24-LIM',
        ean: '5900000000138',
        imageUrl: 'https://cdn.example/terra-1.jpg',
      });
      expect(result.items[0].channelStatus).toEqual({
        publicationStatus: 'active',
        lifecycle: 'Active',
        validationMessages: [],
        lastStatusSyncedAt: now,
      });
      expect(result.items[0].commercial).toEqual({
        price: 100,
        currency: 'PLN',
        availableQuantity: 41,
        lastCommercialSyncedAt: now,
      });
    });

    it('should derive Inactive from an inactive snapshot carrying validator messages', async () => {
      const qb = buildListQb([
        buildRawRow({
          publicationStatus: 'inactive',
          statusDetails: { validationMessages: ['Brak parametru: Marka'] },
        }),
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(result.items[0].channelStatus?.lifecycle).toBe('Inactive');
      expect(result.items[0].channelStatus?.validationMessages).toEqual(['Brak parametru: Marka']);
    });

    it('should null out each projection independently when its join found nothing', async () => {
      const qb = buildListQb([
        buildRawRow({
          productId: null,
          productName: null,
          productImages: null,
          variantSku: null,
          variantEan: null,
          variantAttributes: null,
          publicationStatus: null,
          statusDetails: null,
          lastStatusSyncedAt: null,
          commercialPrice: null,
          commercialCurrency: null,
          commercialAvailableQuantity: null,
          lastCommercialSyncedAt: null,
        }),
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(result.items[0].identity).toBeNull();
      expect(result.items[0].channelStatus).toBeNull();
      expect(result.items[0].commercial).toBeNull();
      expect(result.items[0].internalId).toBe('ol_variant_123');
    });

    it('should page deterministically with an id tiebreaker on the createdAt ordering', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({}, { limit: 50, offset: 100 });

      expect(qb.orderBy).toHaveBeenCalledWith('mapping."createdAt"', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('mapping."id"', 'DESC');
      expect(qb.offset).toHaveBeenCalledWith(100);
      expect(qb.limit).toHaveBeenCalledWith(50);
    });
  });

  describe('countListedVariantsByProducts (#1720)', () => {
    type CoverageQb = {
      select: jest.Mock;
      addSelect: jest.Mock;
      innerJoin: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      groupBy: jest.Mock;
      addGroupBy: jest.Mock;
      getRawMany: jest.Mock;
    };

    function buildCoverageQb(
      rows: Array<{
        productId: string;
        connectionId: string;
        platformType: string;
        listedVariants: string;
      }>
    ): CoverageQb {
      const qb: CoverageQb = {
        select: jest.fn(),
        addSelect: jest.fn(),
        innerJoin: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        groupBy: jest.fn(),
        addGroupBy: jest.fn(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      qb.select.mockReturnValue(qb);
      qb.addSelect.mockReturnValue(qb);
      qb.innerJoin.mockReturnValue(qb);
      qb.where.mockReturnValue(qb);
      qb.andWhere.mockReturnValue(qb);
      qb.groupBy.mockReturnValue(qb);
      qb.addGroupBy.mockReturnValue(qb);
      return qb;
    }

    it('should return [] on empty input without touching the query builder', async () => {
      const result = await repository.countListedVariantsByProducts([]);

      expect(result).toEqual([]);
      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should scope to Offer mappings, join product_variants by table name, and cast counts to numbers', async () => {
      const qb = buildCoverageQb([
        {
          productId: 'ol_product_1',
          connectionId: 'conn-1',
          platformType: 'allegro',
          listedVariants: '2',
        },
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.countListedVariantsByProducts([
        'ol_product_1',
        'ol_product_2',
      ]);

      expect(qb.innerJoin).toHaveBeenCalledWith(
        'product_variants',
        'pv',
        'pv."id" = mapping."internalId"'
      );
      expect(qb.where).toHaveBeenCalledWith('mapping.entityType = :entityType', {
        entityType: 'Offer',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('pv."productId" IN (:...productIds)', {
        productIds: ['ol_product_1', 'ol_product_2'],
      });
      expect(qb.groupBy).toHaveBeenCalledWith('pv."productId"');
      expect(result).toEqual([
        {
          productId: 'ol_product_1',
          connectionId: 'conn-1',
          platformType: 'allegro',
          listedVariants: 2,
        },
      ]);
    });
  });
});
