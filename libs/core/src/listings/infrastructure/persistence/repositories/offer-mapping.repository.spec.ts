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

import { UnfilterableOfferLifecycleException } from '../../../domain/exceptions/unfilterable-offer-lifecycle.exception';
import type { OfferLifecycle } from '../../../domain/types/offer-lifecycle.types';
import { OfferCommercialSnapshotOrmEntity } from '../entities/offer-commercial-snapshot.orm-entity';
import { OfferStatusSnapshotOrmEntity } from '../entities/offer-status-snapshot.orm-entity';
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
      variantIsStale: false,
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

    it('should join the products context by table name and the listings snapshots by entity class', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({}, { limit: 20, offset: 0 });

      // Cross-context: ADR-036 raw table name, no ORM-entity import.
      expect(qb.leftJoin).toHaveBeenCalledWith(
        'product_variants',
        'pv',
        'pv."id" = mapping."internalId"'
      );
      expect(qb.leftJoin).toHaveBeenCalledWith('products', 'p', 'p."id" = pv."productId"');
      // Same-context: the entity class, so a table rename stays a compile error.
      expect(qb.leftJoin).toHaveBeenCalledWith(
        OfferStatusSnapshotOrmEntity,
        'oss',
        'oss."externalOfferId" = mapping."externalId" AND oss."connectionId" = mapping."connectionId"'
      );
      expect(qb.leftJoin).toHaveBeenCalledWith(
        OfferCommercialSnapshotOrmEntity,
        'ocs',
        'ocs."externalOfferId" = mapping."externalId" AND ocs."connectionId" = mapping."connectionId"'
      );
      // A single page is one query builder run - never an N+1 enrichment loop.
      expect(qb.getRawMany).toHaveBeenCalledTimes(1);
    });

    it('should widen search across both product and variant SKU, both barcode columns, name, attributes and externalId', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({ search: 'terra' }, { limit: 20, offset: 0 });

      const searchCall = findSearchCall(qb);
      expect(searchCall).toBeDefined();
      const [clause, params] = searchCall as [string, { search: string }];

      expect(clause).toContain('mapping."externalId" ILIKE :search');
      expect(clause).toContain('p."name" ILIKE :search');
      expect(clause).toContain('p."sku" ILIKE :search');
      expect(clause).toContain('pv."sku" ILIKE :search');
      // `ean` and `gtin` are independently populated - matching one only would
      // leave a variant unfindable by the barcode printed on it.
      expect(clause).toContain('pv."ean" ILIKE :search');
      expect(clause).toContain('pv."gtin" ILIKE :search');
      // Attribute VALUES only - a plain `attributes::text` would also match keys.
      expect(clause).toContain('jsonb_each_text(pv."attributes")');
      expect(clause).toContain('attr.value ILIKE :search');
      expect(params).toEqual({ search: '%terra%' });
    });

    it('should guard the jsonb attribute scan against a non-object value', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({ search: 'terra' }, { limit: 20, offset: 0 });

      // Without this, one malformed row 500s every search on the page.
      expect((findSearchCall(qb) as [string, { search: string }])[0]).toContain(
        'jsonb_typeof(pv."attributes") = \'object\''
      );
    });

    it('should escape ILIKE wildcards and the backslash escape character in the search term', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({ search: '50%_off\\' }, { limit: 20, offset: 0 });

      // The trailing `\` must be escaped or it would escape the appended `%`
      // and silently turn the suffix wildcard into a literal.
      expect((findSearchCall(qb) as [string, { search: string }])[1]).toEqual({
        search: '%50\\%\\_off\\\\%',
      });
    });

    it('should trim the search term before matching', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({ search: '  TERRA-24-LIM \n' }, { limit: 20, offset: 0 });

      expect((findSearchCall(qb) as [string, { search: string }])[1]).toEqual({
        search: '%TERRA-24-LIM%',
      });
    });

    it('should not emit a search predicate when no term was supplied', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({ connectionId: 'conn-uuid' }, { limit: 20, offset: 0 });

      expect(findSearchCall(qb)).toBeUndefined();
    });

    it('should not emit a search predicate when the term is only whitespace', async () => {
      const qb = buildListQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findMany({ search: '   ' }, { limit: 20, offset: 0 });

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
        isStale: false,
      });
      expect(result.items[0].channelStatus).toEqual({
        publicationStatus: 'active',
        lifecycle: 'Active',
        validationMessages: [],
        validationProblems: [],
        lastStatusSyncedAt: now,
      });
      expect(result.items[0].commercial).toEqual({
        price: '100.00',
        currency: 'PLN',
        availableQuantity: 41,
        lastCommercialSyncedAt: now,
      });
    });

    it('should derive Invalid from an inactive snapshot carrying validator messages', async () => {
      const qb = buildListQb([
        buildRawRow({
          publicationStatus: 'inactive',
          statusDetails: { validationMessages: ['Brak parametru: Marka'] },
        }),
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(result.items[0].channelStatus?.lifecycle).toBe('Invalid');
      expect(result.items[0].channelStatus?.validationMessages).toEqual(['Brak parametru: Marka']);
    });

    it('should flag a stale variant so a paused offer is not read as a sell-out (#1689)', async () => {
      const qb = buildListQb([
        buildRawRow({ variantIsStale: true, commercialAvailableQuantity: 0 }),
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(result.items[0].identity?.isStale).toBe(true);
      expect(result.items[0].commercial?.availableQuantity).toBe(0);
    });

    it('should null out identity and commercial independently when their join found nothing', async () => {
      const qb = buildListQb([
        buildRawRow({
          productId: null,
          productName: null,
          productImages: null,
          variantSku: null,
          variantEan: null,
          variantAttributes: null,
          variantIsStale: null,
          commercialPrice: null,
          commercialCurrency: null,
          commercialAvailableQuantity: null,
          lastCommercialSyncedAt: null,
        }),
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(result.items[0].identity).toBeNull();
      expect(result.items[0].commercial).toBeNull();
      expect(result.items[0].internalId).toBe('ol_variant_123');
    });

    it('should bucket a row with no status snapshot as Unsynced rather than leaving it unclassified', async () => {
      const qb = buildListQb([
        buildRawRow({ publicationStatus: null, statusDetails: null, lastStatusSyncedAt: null }),
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      // The exact shape FE-C (#2029) renders its fifth tab from.
      expect(result.items[0].channelStatus).toEqual({
        publicationStatus: null,
        lifecycle: 'Unsynced',
        validationMessages: [],
        validationProblems: [],
        lastStatusSyncedAt: null,
      });
    });

    it('should read a publication status outside the union as Unsynced rather than leaving the row on no tab', async () => {
      const qb = buildListQb([buildRawRow({ publicationStatus: 'suspended' })]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      // The column is unconstrained text; without narrowing, the exhaustive
      // switch returns undefined and the row renders on no lifecycle tab.
      expect(result.items[0].channelStatus).toEqual({
        publicationStatus: null,
        lifecycle: 'Unsynced',
        validationMessages: [],
        validationProblems: [],
        lastStatusSyncedAt: null,
      });
    });

    it('should report an absent product name honestly rather than as a blank string', async () => {
      const qb = buildListQb([buildRawRow({ productName: null })]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(result.items[0].identity?.productName).toBeNull();
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

    describe('lifecycle filter (#2026)', () => {
      /** The `andWhere` call carrying the lifecycle predicate, if one was emitted. */
      function findLifecycleCall(qb: ListQb): [string, Record<string, unknown>] | undefined {
        const calls = qb.andWhere.mock.calls as Array<[string, Record<string, unknown>?]>;
        const call = calls.find(([clause]) => clause.includes('publicationStatus'));
        return call ? [call[0], call[1] ?? {}] : undefined;
      }

      it('should not emit a lifecycle predicate when no bucket was selected', async () => {
        const qb = buildListQb([]);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

        await repository.findMany({}, { limit: 20, offset: 0 });

        expect(findLifecycleCall(qb)).toBeUndefined();
      });

      it('should filter Unsynced by the ABSENCE of a status snapshot OR an unrecognised status value', async () => {
        const qb = buildListQb([]);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

        await repository.findMany({ lifecycle: 'Unsynced' }, { limit: 20, offset: 0 });

        const calls = qb.andWhere.mock.calls as Array<[string, unknown?]>;
        const clause = calls.map(([sql]) => sql).find((sql) => sql.startsWith('NOT '));
        // Must be the complement of BOTH "no snapshot" and "unrecognised status" -
        // a synced snapshot carrying an out-of-union value (#2032 review thread 1)
        // must also land here, or it lands on no tab at all.
        expect(clause).toBe(
          'NOT ((oss."publicationStatus" IS NOT NULL AND oss."lastStatusSyncedAt" IS NOT NULL) AND ' +
            "oss.\"publicationStatus\" IN ('active', 'activating', 'inactivating', 'inactive', 'ended'))"
        );
      });

      it('should collapse Active to a plain status IN, never inspecting the jsonb blob', async () => {
        const qb = buildListQb([]);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

        await repository.findMany({ lifecycle: 'Active' }, { limit: 20, offset: 0 });

        const [clause, parameters] = findLifecycleCall(qb) as [string, Record<string, unknown>];
        expect(clause).toContain('oss."publicationStatus" IN (:...lifecycleStatuses)');
        // The default tab must not pay for a per-row jsonb inspection.
        expect(clause).not.toContain('jsonb_array_length');
        expect(parameters.lifecycleStatuses).toEqual(['active', 'activating', 'inactivating']);
      });

      it('should require a status snapshot for every non-Unsynced bucket', async () => {
        const qb = buildListQb([]);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

        await repository.findMany({ lifecycle: 'Ended' }, { limit: 20, offset: 0 });

        const [clause] = findLifecycleCall(qb) as [string, Record<string, unknown>];
        expect(clause).toContain(
          '(oss."publicationStatus" IS NOT NULL AND oss."lastStatusSyncedAt" IS NOT NULL)'
        );
      });

      it('should split Invalid from Draft on validator-message presence', async () => {
        const inactiveQb = buildListQb([]);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(inactiveQb);
        await repository.findMany({ lifecycle: 'Invalid' }, { limit: 20, offset: 0 });

        const draftQb = buildListQb([]);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(draftQb);
        await repository.findMany({ lifecycle: 'Draft' }, { limit: 20, offset: 0 });

        const [inactiveClause, inactiveParams] = findLifecycleCall(inactiveQb) as [
          string,
          Record<string, unknown>,
        ];
        const [draftClause, draftParams] = findLifecycleCall(draftQb) as [
          string,
          Record<string, unknown>,
        ];

        expect(inactiveParams).toEqual({ lifecycleStatus0: 'inactive' });
        expect(draftParams).toEqual({ lifecycleStatus0: 'inactive' });
        // Same status, opposite message-presence - the ONLY signal separating them.
        expect(inactiveClause).toContain('jsonb_array_length');
        expect(inactiveClause).not.toContain('AND NOT (CASE');
        expect(draftClause).toContain('AND NOT (CASE');
      });

      it('should guard the jsonb message probe against a non-array value', async () => {
        const qb = buildListQb([]);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

        await repository.findMany({ lifecycle: 'Invalid' }, { limit: 20, offset: 0 });

        // jsonb_array_length RAISES on a non-array, which would 500 the tab.
        const [clause] = findLifecycleCall(qb) as [string, Record<string, unknown>];
        expect(clause).toContain(
          `jsonb_typeof(oss."statusDetails" -> 'validationMessages') = 'array'`
        );
      });

      it('should report the selected bucket size as total so paging inside a tab is correct', async () => {
        const qb = buildListQb([buildRawRow()], 7);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

        const result = await repository.findMany({ lifecycle: 'Ended' }, { limit: 20, offset: 0 });

        // getCount runs with the lifecycle predicate already attached.
        expect(result.total).toBe(7);
      });

      it('should throw rather than silently serve the Unsynced page for a bucket it cannot express', async () => {
        const qb = buildListQb([]);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

        // Stands in for a sixth bucket keyed on something outside the closed
        // `OfferSnapshotFacts` pair (variant staleness, snapshot age, a
        // creation-record field). It resolves to no facts - exactly like
        // `Unsynced` - so a length check alone would hand it the Unsynced
        // predicate: a wrong page, no error, no failing type-check.
        await expect(
          repository.findMany({ lifecycle: 'Archived' as OfferLifecycle }, { limit: 20, offset: 0 })
        ).rejects.toBeInstanceOf(UnfilterableOfferLifecycleException);

        const calls = qb.andWhere.mock.calls as Array<[string, unknown?]>;
        expect(calls.some(([clause]) => clause.startsWith('NOT '))).toBe(false);
      });

      it('should keep the other filters alongside the lifecycle narrowing', async () => {
        const qb = buildListQb([]);
        (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

        await repository.findMany(
          { lifecycle: 'Ended', connectionId: 'conn-uuid', search: 'terra' },
          { limit: 20, offset: 0 }
        );

        expect(qb.andWhere).toHaveBeenCalledWith('mapping.connectionId = :connectionId', {
          connectionId: 'conn-uuid',
        });
        expect(findSearchCall(qb)).toBeDefined();
        expect(findLifecycleCall(qb)).toBeDefined();
      });
    });
  });

  describe('countByLifecycle (#2026)', () => {
    type CountsQb = {
      leftJoin: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      select: jest.Mock;
      addSelect: jest.Mock;
      groupBy: jest.Mock;
      addGroupBy: jest.Mock;
      getRawMany: jest.Mock;
    };

    interface CountRow {
      publicationStatus: string | null;
      hasStatusSnapshot: boolean;
      hasValidationMessages: boolean;
      count: string;
    }

    function buildCountsQb(rows: CountRow[]): CountsQb {
      const qb: CountsQb = {
        leftJoin: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        select: jest.fn(),
        addSelect: jest.fn(),
        groupBy: jest.fn(),
        addGroupBy: jest.fn(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      for (const key of Object.keys(qb) as Array<keyof CountsQb>) {
        if (key !== 'getRawMany') qb[key].mockReturnValue(qb);
      }
      return qb;
    }

    const synced = (
      publicationStatus: string,
      count: number,
      hasValidationMessages = false
    ): CountRow => ({
      publicationStatus,
      hasStatusSnapshot: true,
      hasValidationMessages,
      count: String(count),
    });

    const unsynced = (count: number): CountRow => ({
      publicationStatus: null,
      hasStatusSnapshot: false,
      hasValidationMessages: false,
      count: String(count),
    });

    it('should fold each raw fact group through the same rule the list rows use', async () => {
      const qb = buildCountsQb([
        synced('active', 4),
        synced('activating', 1),
        synced('inactivating', 2),
        synced('ended', 5),
        synced('inactive', 3, true),
        synced('inactive', 6),
        unsynced(90),
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const counts = await repository.countByLifecycle({});

      expect(counts).toEqual({
        Active: 7,
        Invalid: 3,
        Draft: 6,
        Ended: 5,
        Unsynced: 90,
      });
    });

    it('should sum to the same total the unfiltered list reports', async () => {
      const rows = [synced('active', 4), synced('inactive', 3, true), unsynced(90)];
      const qb = buildCountsQb(rows);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const counts = await repository.countByLifecycle({});
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

      expect(total).toBe(97);
    });

    it('should count a mapping with no status snapshot as Unsynced, not drop it', async () => {
      const qb = buildCountsQb([unsynced(12)]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      // The majority state on a large catalog - dropping it would read as a
      // seller having lost most of their listings.
      expect((await repository.countByLifecycle({})).Unsynced).toBe(12);
    });

    it('should count a snapshot row with no sync timestamp as Unsynced, matching the list projection', async () => {
      const qb = buildCountsQb([
        { publicationStatus: 'active', hasStatusSnapshot: false, hasValidationMessages: false, count: '3' },
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      expect((await repository.countByLifecycle({})).Unsynced).toBe(3);
    });

    it('should report every bucket, zeroed, when nothing matched', async () => {
      const qb = buildCountsQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      // A tab with no rows must render "0", never vanish.
      expect(await repository.countByLifecycle({})).toEqual({
        Active: 0,
        Invalid: 0,
        Draft: 0,
        Ended: 0,
        Unsynced: 0,
      });
    });

    it('should group by the raw snapshot facts, never by a lifecycle bucket', async () => {
      const qb = buildCountsQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.countByLifecycle({});

      expect(qb.groupBy).toHaveBeenCalledWith('oss."publicationStatus"');
      expect(qb.addGroupBy).toHaveBeenCalledWith(
        '(oss."publicationStatus" IS NOT NULL AND oss."lastStatusSyncedAt" IS NOT NULL)'
      );
      // The bucket names must not appear in SQL - the rule lives in TypeScript.
      // Every clause-emitting call is scanned, not just the projection ones: a
      // future edit pushing a bucket name into a WHERE on the count path would
      // otherwise slip past this guard.
      const emittedSql = [
        ...(qb.groupBy.mock.calls as unknown[][]),
        ...(qb.addGroupBy.mock.calls as unknown[][]),
        ...(qb.addSelect.mock.calls as unknown[][]),
        ...(qb.select.mock.calls as unknown[][]),
        ...(qb.where.mock.calls as unknown[][]),
        ...(qb.andWhere.mock.calls as unknown[][]),
      ]
        .flat()
        .filter((argument): argument is string => typeof argument === 'string')
        .join(' ');
      for (const bucket of ['Active', 'Invalid', 'Draft', 'Ended', 'Unsynced']) {
        expect(emittedSql).not.toContain(bucket);
      }
    });

    it('should apply the same connection and search predicates as the list', async () => {
      const qb = buildCountsQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.countByLifecycle({ connectionId: 'conn-uuid', search: 'terra' });

      expect(qb.where).toHaveBeenCalledWith('mapping.entityType = :entityType', {
        entityType: 'Offer',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('mapping.connectionId = :connectionId', {
        connectionId: 'conn-uuid',
      });
      const searchCall = (qb.andWhere.mock.calls as Array<[string, { search?: string }?]>).find(
        (call) => call[1]?.search !== undefined
      );
      expect(searchCall?.[1]).toEqual({ search: '%terra%' });
    });

    it('should build the same reporting joins as the list, so the counts describe the same rows', async () => {
      const qb = buildCountsQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.countByLifecycle({ search: 'terra' });

      // The search predicate spans the product/variant joins - without them
      // the counts would silently describe a narrower row set than the page.
      expect(qb.leftJoin).toHaveBeenCalledWith(
        'product_variants',
        'pv',
        'pv."id" = mapping."internalId"'
      );
      expect(qb.leftJoin).toHaveBeenCalledWith('products', 'p', 'p."id" = pv."productId"');
      expect(qb.leftJoin).toHaveBeenCalledWith(
        OfferStatusSnapshotOrmEntity,
        'oss',
        'oss."externalOfferId" = mapping."externalId" AND oss."connectionId" = mapping."connectionId"'
      );
    });

    it('should never narrow itself by a lifecycle bucket, or selecting a tab would zero the others', async () => {
      const qb = buildCountsQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.countByLifecycle({ connectionId: 'conn-uuid' });

      const lifecyclePredicate = (qb.andWhere.mock.calls as Array<[string, unknown?]>).find(
        ([clause]) => clause.includes('oss."publicationStatus"')
      );
      expect(lifecyclePredicate).toBeUndefined();
    });

    it('should coerce the bigint COUNT the driver returns as a string', async () => {
      const qb = buildCountsQb([synced('active', 12)]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const counts = await repository.countByLifecycle({});

      expect(counts.Active).toBe(12);
      expect(typeof counts.Active).toBe('number');
    });

    it('should count DISTINCT mapping ids, the same count shape the list total uses', async () => {
      const qb = buildCountsQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.countByLifecycle({});

      // `getCount()` on the list path compiles to COUNT(DISTINCT mapping.id).
      // A plain COUNT(*) here would agree only by accident, and would inflate
      // past the total the day a 1:N join reaches the shared builder.
      expect(qb.addSelect).toHaveBeenCalledWith('COUNT(DISTINCT mapping.id)', 'count');
    });

    it('should keep an unrecognised publication status inside the partition instead of dropping it', async () => {
      // `offer_status_snapshots."publicationStatus"` is unconstrained text, so a
      // value outside the union is reachable. Untreated it falls off the end of
      // the exhaustive switch as `undefined`, lands on a stray counts key as
      // NaN and vanishes from all five buckets - a silent under-count.
      const qb = buildCountsQb([
        {
          publicationStatus: 'suspended',
          hasStatusSnapshot: true,
          hasValidationMessages: false,
          count: '5',
        },
        synced('active', 2),
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const counts = await repository.countByLifecycle({});

      expect(counts).toEqual({ Active: 2, Invalid: 0, Draft: 0, Ended: 0, Unsynced: 5 });
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      expect(total).toBe(7);
      expect(Object.keys(counts).sort()).toEqual(
        ['Active', 'Draft', 'Ended', 'Invalid', 'Unsynced'].sort()
      );
    });
  });

  describe('snapshot-presence agreement between the list and its counts (#2026)', () => {
    // `HAS_STATUS_SNAPSHOT_SQL` encodes "the snapshot exists" as a pair of null
    // checks that `toChannelStatus` re-encodes in TypeScript. That pair is the
    // one lifecycle rule still hand-duplicated, and it decides the Unsynced
    // bucket - i.e. most of a fresh catalog. These cases pin the two together.
    type PresenceCase = {
      label: string;
      publicationStatus: string | null;
      lastStatusSyncedAt: Date | null;
      /** What the SQL predicate yields for the same row. */
      hasStatusSnapshot: boolean;
    };

    const cases: PresenceCase[] = [
      {
        label: 'no snapshot row at all',
        publicationStatus: null,
        lastStatusSyncedAt: null,
        hasStatusSnapshot: false,
      },
      {
        label: 'a status with no sync timestamp',
        publicationStatus: 'active',
        lastStatusSyncedAt: null,
        hasStatusSnapshot: false,
      },
      {
        label: 'a sync timestamp with no status',
        publicationStatus: null,
        lastStatusSyncedAt: new Date('2026-04-20T10:00:00Z'),
        hasStatusSnapshot: false,
      },
    ];

    it.each(cases)('should read $label as Unsynced on BOTH paths', async (testCase) => {
      const listQb = {
        leftJoin: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        select: jest.fn(),
        addSelect: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        offset: jest.fn(),
        limit: jest.fn(),
        getCount: jest.fn().mockResolvedValue(1),
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'mapping-uuid',
            entityType: 'Offer',
            internalId: 'ol_variant_123',
            externalId: 'allegro-offer-1',
            platformType: 'allegro',
            connectionId: 'conn-uuid',
            context: null,
            createdAt: now,
            updatedAt: now,
            productId: null,
            productName: null,
            productImages: null,
            variantSku: null,
            variantEan: null,
            variantAttributes: null,
            variantIsStale: null,
            publicationStatus: testCase.publicationStatus,
            statusDetails: null,
            lastStatusSyncedAt: testCase.lastStatusSyncedAt,
            commercialPrice: null,
            commercialCurrency: null,
            commercialAvailableQuantity: null,
            lastCommercialSyncedAt: null,
          },
        ]),
      };
      for (const [key, value] of Object.entries(listQb)) {
        if (key !== 'getCount' && key !== 'getRawMany') {
          (value).mockReturnValue(listQb);
        }
      }
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(listQb);
      const list = await repository.findMany({}, { limit: 20, offset: 0 });

      const countsQb = {
        leftJoin: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        select: jest.fn(),
        addSelect: jest.fn(),
        groupBy: jest.fn(),
        addGroupBy: jest.fn(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            publicationStatus: testCase.publicationStatus,
            hasStatusSnapshot: testCase.hasStatusSnapshot,
            hasValidationMessages: false,
            count: '1',
          },
        ]),
      };
      for (const [key, value] of Object.entries(countsQb)) {
        if (key !== 'getRawMany') (value).mockReturnValue(countsQb);
      }
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(countsQb);
      const counts = await repository.countByLifecycle({});

      expect(list.items[0].channelStatus.lifecycle).toBe('Unsynced');
      expect(counts.Unsynced).toBe(1);
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
