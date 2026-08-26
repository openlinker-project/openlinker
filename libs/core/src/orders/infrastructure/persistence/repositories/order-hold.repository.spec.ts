/**
 * OrderHoldRepository — error-translation spec (#2338)
 *
 * The subject here is port rule **R4**: no TypeORM error type escapes the port.
 * The database-level guarantees (the partial unique index, the actor CHECK) are
 * asserted against real Postgres in
 * `apps/api/test/integration/orders/order-holds.int-spec.ts` — a mock cannot
 * express them, and asserting them here would only prove the mock.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 */
import { QueryFailedError, type Repository } from 'typeorm';
import { HoldAlreadyReleasedError } from '../../../domain/exceptions/hold-already-released.error';
import { OrderAlreadyOnHoldError } from '../../../domain/exceptions/order-already-on-hold.error';
import { OrderHoldNotFoundError } from '../../../domain/exceptions/order-hold-not-found.error';
import { OrderHoldVocabularyError } from '../../../domain/exceptions/order-hold-vocabulary.error';
import type { PlaceOrderHoldInput } from '../../../domain/types/order-hold.types';
import { OrderHoldOrmEntity } from '../entities/order-hold.orm-entity';
import { OrderHoldRepository } from './order-hold.repository';

const PLACED_AT = new Date('2026-08-01T10:00:00.000Z');
const RELEASED_AT = new Date('2026-08-02T10:00:00.000Z');

const buildRow = (overrides: Partial<OrderHoldOrmEntity> = {}): OrderHoldOrmEntity =>
  Object.assign(new OrderHoldOrmEntity(), {
    id: 'hold-1',
    internalOrderId: 'ol_order_aaa',
    reason: 'fraud-review',
    note: null,
    placedByUserId: 'user-1',
    placedByService: null,
    placedAt: PLACED_AT,
    releasedAt: null,
    releasedByUserId: null,
    releaseNote: null,
    createdAt: PLACED_AT,
    updatedAt: PLACED_AT,
    ...overrides,
  });

const placeInput: PlaceOrderHoldInput = {
  internalOrderId: 'ol_order_aaa',
  reason: 'fraud-review',
  note: null,
  placedBy: { kind: 'user', userId: 'user-1' },
  placedAt: PLACED_AT,
};

const uniqueViolation = (): QueryFailedError => {
  const error = new QueryFailedError('INSERT', [], new Error('duplicate key'));
  (error as QueryFailedError & { code?: string }).code = '23505';
  return error;
};

interface MockRepo {
  save: jest.Mock;
  find: jest.Mock;
  findOne: jest.Mock;
  createQueryBuilder: jest.Mock;
}

const createMockRepo = (): MockRepo => ({
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
});

/** A chainable QueryBuilder stub whose `execute` resolves the given raw rows. */
interface StubUpdateBuilder {
  update: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  returning: jest.Mock;
  execute: jest.Mock;
}

const stubUpdateBuilder = (raw: OrderHoldOrmEntity[]): StubUpdateBuilder => {
  const builder: StubUpdateBuilder = {
    update: jest.fn(() => builder),
    set: jest.fn(() => builder),
    where: jest.fn(() => builder),
    returning: jest.fn(() => builder),
    execute: jest.fn().mockResolvedValue({ raw, affected: raw.length }),
  };
  return builder;
};

describe('OrderHoldRepository (#2338)', () => {
  let repo: MockRepo;
  let subject: OrderHoldRepository;

  beforeEach(() => {
    repo = createMockRepo();
    subject = new OrderHoldRepository(
      repo as unknown as Repository<OrderHoldOrmEntity>
    );
  });

  describe('placeIfNoneOpen', () => {
    it('should flatten a user actor onto placedByUserId and leave placedByService null', async () => {
      repo.save.mockResolvedValue(buildRow());

      const hold = await subject.placeIfNoneOpen(placeInput);

      expect(hold.placedByUserId).toBe('user-1');
      expect(hold.placedByService).toBeNull();
      expect(hold.isOpen()).toBe(true);
    });

    it('should flatten a service actor onto placedByService and leave placedByUserId null', async () => {
      repo.save.mockResolvedValue(
        buildRow({ placedByUserId: null, placedByService: 'risk-engine' })
      );

      const hold = await subject.placeIfNoneOpen({
        ...placeInput,
        placedBy: { kind: 'service', service: 'risk-engine' },
      });

      expect(hold.placedByService).toBe('risk-engine');
      expect(hold.placedByUserId).toBeNull();
    });

    it('should raise OrderAlreadyOnHoldError naming the winning hold when the slot is taken', async () => {
      repo.save.mockRejectedValue(uniqueViolation());
      repo.findOne.mockResolvedValue(buildRow({ id: 'hold-winner' }));

      const error = await subject.placeIfNoneOpen(placeInput).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OrderAlreadyOnHoldError);
      expect(error).not.toBeInstanceOf(QueryFailedError);
      expect((error as OrderAlreadyOnHoldError).openHoldId).toBe('hold-winner');
      expect((error as OrderAlreadyOnHoldError).internalOrderId).toBe(
        'ol_order_aaa'
      );
    });

    it('should rethrow the original conflict when the winner was released before it could be read', async () => {
      // Reporting "already on hold" here would be a false statement about an
      // order that is no longer held. The caller retries into a clean insert.
      const conflict = uniqueViolation();
      repo.save.mockRejectedValue(conflict);
      repo.findOne.mockResolvedValue(null);

      await expect(subject.placeIfNoneOpen(placeInput)).rejects.toBe(conflict);
    });

    it('should propagate a non-23505 QueryFailedError untranslated', async () => {
      // A repository that swallowed every database error would be worse than
      // one that leaked. R4 translates the anticipated conflict, nothing else.
      const other = new QueryFailedError('INSERT', [], new Error('deadlock'));
      (other as QueryFailedError & { code?: string }).code = '40P01';
      repo.save.mockRejectedValue(other);

      await expect(subject.placeIfNoneOpen(placeInput)).rejects.toBe(other);
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('releaseHeld', () => {
    const releaseInput = {
      holdId: 'hold-1',
      releasedAt: RELEASED_AT,
      releaseNote: 'cleared',
      releasedByUserId: 'user-2',
    };

    it('should return the stamped row from the conditional update', async () => {
      repo.createQueryBuilder.mockReturnValue(
        stubUpdateBuilder([
          buildRow({
            releasedAt: RELEASED_AT,
            releasedByUserId: 'user-2',
            releaseNote: 'cleared',
          }),
        ])
      );

      const hold = await subject.releaseHeld(releaseInput);

      expect(hold.isOpen()).toBe(false);
      expect(hold.releasedByUserId).toBe('user-2');
      // One statement — no read-after-write on the success path.
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('should raise HoldAlreadyReleasedError when the row exists but is already released', async () => {
      repo.createQueryBuilder.mockReturnValue(stubUpdateBuilder([]));
      repo.findOne.mockResolvedValue(buildRow({ releasedAt: RELEASED_AT }));

      const error = await subject.releaseHeld(releaseInput).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HoldAlreadyReleasedError);
      expect(error).not.toBeInstanceOf(QueryFailedError);
      expect((error as HoldAlreadyReleasedError).releasedAt).toEqual(RELEASED_AT);
    });

    it('should raise OrderHoldNotFoundError when no such hold exists', async () => {
      // The two zero-affected causes are different facts: claiming a hold that
      // never existed was "already released" is a false statement.
      repo.createQueryBuilder.mockReturnValue(stubUpdateBuilder([]));
      repo.findOne.mockResolvedValue(null);

      await expect(subject.releaseHeld(releaseInput)).rejects.toBeInstanceOf(
        OrderHoldNotFoundError
      );
    });
  });

  describe('toDomain vocabulary coercion', () => {
    it('should raise OrderHoldVocabularyError rather than defaulting an unrecognised reason', async () => {
      // Silently mapping onto `operator` would attribute a machine's hold to a
      // human — what `isHoldReason`'s no-fallback posture exists to prevent.
      repo.findOne.mockResolvedValue(buildRow({ reason: 'from-a-newer-build' }));

      const error = await subject.findById('hold-1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OrderHoldVocabularyError);
      expect((error as OrderHoldVocabularyError).value).toBe('from-a-newer-build');
    });
  });

  describe('findOpenByOrders', () => {
    it('should answer an empty id list without querying', async () => {
      // An empty `In([])` builds `IN ()` — a syntax error on some drivers, a
      // full scan on others.
      await expect(subject.findOpenByOrders([])).resolves.toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });
});
