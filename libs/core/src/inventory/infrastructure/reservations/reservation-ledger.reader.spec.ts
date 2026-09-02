/**
 * Reservation Ledger Reader unit spec (#2345)
 *
 * The predicate IS the contract here — a missing `status` arm subtracts every
 * release the system ever performed, a missing `atpEffect` bind subtracts
 * diagnostic holds from a real published quantity, and a missing `isStale` arm
 * under-publishes a variant whose position was staled. The query builder is
 * therefore captured and its arms asserted; the SQL itself is exercised against
 * real Postgres by `apps/api/test/integration/atp-subtraction.int-spec.ts`.
 *
 * @module libs/core/src/inventory/infrastructure/reservations
 */
import type { Repository } from 'typeorm';
import { ReservationLedgerReader } from './reservation-ledger.reader';
import { InventoryItemOrmEntity } from '../persistence/entities/inventory-item.orm-entity';
import type { ReservationOrmEntity } from '../persistence/entities/reservation.orm-entity';
import type { AvailabilityScope } from '../../domain/types/availability.types';
import { UnsupportedAvailabilityScopeError } from '../../domain/exceptions/unsupported-availability-scope.error';

interface CapturedQuery {
  readonly innerJoin: unknown[][];
  readonly where: unknown[][];
  readonly andWhere: unknown[][];
  readonly groupBy: unknown[][];
}

const CHANNEL_SCOPE: AvailabilityScope = { kind: 'channel', connectionId: 'conn-1' };
const GLOBAL_SCOPE: AvailabilityScope = { kind: 'global' };

type ReservedRow = { productVariantId: string; reserved: string | number };

/**
 * The slice of TypeORM's query builder the reader touches.
 *
 * Declared explicitly rather than inferred: a self-referential `typeof qb` on
 * the object literal is a `TS7022` circularity, and an untyped fake is how a
 * predicate assertion quietly stops type-checking.
 */
interface FakeQueryBuilder {
  innerJoin(...args: unknown[]): FakeQueryBuilder;
  select(...args: unknown[]): FakeQueryBuilder;
  addSelect(...args: unknown[]): FakeQueryBuilder;
  where(...args: unknown[]): FakeQueryBuilder;
  andWhere(...args: unknown[]): FakeQueryBuilder;
  groupBy(...args: unknown[]): FakeQueryBuilder;
  getRawMany(): Promise<readonly ReservedRow[]>;
}

const buildReader = (
  rows: readonly ReservedRow[]
): { reader: ReservationLedgerReader; captured: CapturedQuery } => {
  const captured: CapturedQuery = { innerJoin: [], where: [], andWhere: [], groupBy: [] };

  const qb: FakeQueryBuilder = {
    innerJoin(...args: unknown[]) {
      captured.innerJoin.push(args);
      return qb;
    },
    select() {
      return qb;
    },
    addSelect() {
      return qb;
    },
    where(...args: unknown[]) {
      captured.where.push(args);
      return qb;
    },
    andWhere(...args: unknown[]) {
      captured.andWhere.push(args);
      return qb;
    },
    groupBy(...args: unknown[]) {
      captured.groupBy.push(args);
      return qb;
    },
    getRawMany() {
      return Promise.resolve(rows);
    },
  };

  const repository = {
    createQueryBuilder: (): FakeQueryBuilder => qb,
  } as unknown as Repository<ReservationOrmEntity>;

  return { reader: new ReservationLedgerReader(repository), captured };
};

/** Flatten every predicate fragment the builder received, in order. */
const predicatesOf = (captured: CapturedQuery): string[] =>
  [...captured.where, ...captured.andWhere].map((args) => String(args[0]));

/** Merge every bound-parameter object the builder received. */
const paramsOf = (captured: CapturedQuery): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  for (const args of [...captured.where, ...captured.andWhere]) {
    Object.assign(merged, (args[1] ?? {}) as Record<string, unknown>);
  }
  return merged;
};

describe('ReservationLedgerReader', () => {
  describe('sumReservedByVariantIds', () => {
    it('should filter to held rows carrying the requested stamp, on live positions only', async () => {
      const { reader, captured } = buildReader([]);

      await reader.sumReservedByVariantIds({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        atpEffect: 'published',
      });

      const predicates = predicatesOf(captured);
      expect(predicates).toEqual(
        expect.arrayContaining([
          'r."status" = :status',
          'r."atpEffect" = :atpEffect',
          'inv."productVariantId" IN (:...variantIds)',
          'inv."isStale" = false',
        ])
      );
      expect(paramsOf(captured)).toMatchObject({
        status: 'held',
        atpEffect: 'published',
        variantIds: ['v1'],
      });
    });

    it('should bind the caller-supplied stamp rather than deriving one', async () => {
      const { reader, captured } = buildReader([]);

      await reader.sumReservedByVariantIds({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        atpEffect: 'diagnostic',
      });

      expect(paramsOf(captured)).toMatchObject({ atpEffect: 'diagnostic' });
    });

    it('should group the sum by the position variant, so it matches the availability term', async () => {
      const { reader, captured } = buildReader([]);

      await reader.sumReservedByVariantIds({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        atpEffect: 'published',
      });

      expect(captured.groupBy).toEqual([['inv."productVariantId"']]);
      // The join target is the ORM ENTITY, not the raw table name — that is what
      // makes a table rename a compile break rather than a runtime failure.
      expect(captured.innerJoin).toEqual([
        [InventoryItemOrmEntity, 'inv', 'inv."id" = r."inventoryItemId"'],
      ]);
    });

    it('should coerce the driver string SUM to a number', async () => {
      const { reader } = buildReader([{ productVariantId: 'v1', reserved: '7' }]);

      const sums = await reader.sumReservedByVariantIds({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        atpEffect: 'published',
      });

      expect(sums.get('v1')).toBe(7);
    });

    it('should return an empty map without issuing a statement when no variants are asked about', async () => {
      const { reader, captured } = buildReader([]);

      const sums = await reader.sumReservedByVariantIds({
        variantIds: [],
        scope: CHANNEL_SCOPE,
        atpEffect: 'published',
      });

      expect(sums.size).toBe(0);
      expect(captured.where).toHaveLength(0);
    });

    it('should answer a global scope with the same sum as a channel scope', async () => {
      const { reader } = buildReader([{ productVariantId: 'v1', reserved: 4 }]);

      const sums = await reader.sumReservedByVariantIds({
        variantIds: ['v1'],
        scope: GLOBAL_SCOPE,
        atpEffect: 'published',
      });

      expect(sums.get('v1')).toBe(4);
    });

    it.each(['location', 'order', 'work'] as const)(
      'should refuse a %s scope rather than return an unfiltered sum',
      async (kind) => {
        const { reader } = buildReader([{ productVariantId: 'v1', reserved: 4 }]);
        const scope = {
          location: { kind: 'location', locationId: 'loc-1' },
          order: { kind: 'order', orderId: 'ord-1' },
          work: { kind: 'work', workId: 'w-1' },
        }[kind] as AvailabilityScope;

        await expect(
          reader.sumReservedByVariantIds({
            variantIds: ['v1'],
            scope,
            atpEffect: 'published',
          })
        ).rejects.toBeInstanceOf(UnsupportedAvailabilityScopeError);
      }
    );

    it('should refuse an unsupported scope BEFORE short-circuiting on an empty variant list', async () => {
      const { reader } = buildReader([]);

      await expect(
        reader.sumReservedByVariantIds({
          variantIds: [],
          scope: { kind: 'location', locationId: 'loc-1' },
          atpEffect: 'published',
        })
      ).rejects.toBeInstanceOf(UnsupportedAvailabilityScopeError);
    });
  });
});
