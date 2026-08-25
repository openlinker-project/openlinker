/**
 * Return Repository — orphan re-attribution reads + claim (#2332)
 *
 * A separate file from `return.repository.spec.ts` because these three methods are the
 * only query-builder-based ones on the repository and need a chainable builder mock
 * rather than that file's raw-`query` / `find` doubles.
 *
 * They assert the STATEMENT the repository composes — the candidate predicate, the
 * ordering direction, and the `IS NULL` arm that makes the claim both the concurrency
 * seam and the monotonicity guarantee. What those statements do to real rows belongs to
 * the integration suite.
 *
 * @module infrastructure/persistence/repositories
 */
import { ReturnRepository } from './return.repository';
import { ReturnPersistenceError } from '../../../domain/exceptions/return-persistence.error';

describe('ReturnRepository — orphan re-attribution', () => {
  let repository: ReturnRepository;
  let builder: Record<string, jest.Mock>;

  const chain = (): Record<string, jest.Mock> => {
    const self: Record<string, jest.Mock> = {};
    for (const method of [
      'select',
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'limit',
      'offset',
      'update',
      'set',
    ]) {
      self[method] = jest.fn(() => self);
    }
    self.getRawMany = jest.fn().mockResolvedValue([]);
    self.getCount = jest.fn().mockResolvedValue(0);
    self.execute = jest.fn().mockResolvedValue({ affected: 1 });
    return self;
  };

  beforeEach(() => {
    builder = chain();
    repository = new ReturnRepository(
      { createQueryBuilder: jest.fn(() => builder) } as never,
      { find: jest.fn() } as never,
      { transaction: jest.fn() } as never
    );
  });

  const conditions = (): string =>
    [...builder.where.mock.calls, ...builder.andWhere.mock.calls]
      .map((call: unknown[]) => String(call[0]))
      .join(' | ');

  const firstArg = (mock: jest.Mock): unknown => (mock.mock.calls as unknown[][])[0][0];

  describe('findOrphansForReattribution', () => {
    it('should page orphans that still carry a source order reference, newest first', async () => {
      builder.getRawMany.mockResolvedValue([{ r_id: 'ol_return_1', r_externalOrderId: 'SRC-1' }]);

      const page = await repository.findOrphansForReattribution('conn-1', 10, 20);

      expect(page).toEqual([{ id: 'ol_return_1', externalOrderId: 'SRC-1' }]);
      expect(conditions()).toContain('"internalOrderId" IS NULL');
      // A return the source never attached to an order has nothing to resolve BY and
      // would sit in the candidate set forever.
      expect(conditions()).toContain('"externalOrderId" IS NOT NULL');
      // Newest-first — deliberately the OPPOSITE direction to `findForSourceSweep`.
      expect(builder.orderBy).toHaveBeenCalledWith('r."createdAt"', 'DESC');
      expect([firstArg(builder.limit), firstArg(builder.offset)]).toEqual([10, 20]);
    });
  });

  describe('countOrphansForReattribution', () => {
    it('should count with the same predicate the candidate page uses', async () => {
      builder.getCount.mockResolvedValue(4);

      await expect(repository.countOrphansForReattribution('conn-1')).resolves.toBe(4);
      expect(conditions()).toContain('"internalOrderId" IS NULL');
      expect(conditions()).toContain('"externalOrderId" IS NOT NULL');
    });
  });

  describe('claimAttribution', () => {
    it('should claim only while the return is still an orphan', async () => {
      await expect(repository.claimAttribution('ol_return_1', 'ol_order_9')).resolves.toBe(true);

      expect(conditions()).toContain('"internalOrderId" IS NULL');
      expect(firstArg(builder.set)).toMatchObject({ internalOrderId: 'ol_order_9' });
    });

    it('should report a lost race rather than throwing when a peer attributed first', async () => {
      builder.execute.mockResolvedValue({ affected: 0 });

      await expect(repository.claimAttribution('ol_return_1', 'ol_order_9')).resolves.toBe(false);
    });

    it('should convert a persistence fault into a domain error', async () => {
      builder.execute.mockRejectedValue(new Error('connection reset'));

      await expect(repository.claimAttribution('ol_return_1', 'ol_order_9')).rejects.toBeInstanceOf(
        ReturnPersistenceError
      );
    });
  });
});
