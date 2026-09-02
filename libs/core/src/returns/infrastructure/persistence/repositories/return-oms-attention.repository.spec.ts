/**
 * ReturnRepository.updateOmsAttention — unit spec (#2352)
 *
 * The producer-scoped, level-triggered write. It gets its own spec file rather
 * than joining `return.repository.spec.ts`, whose harness wires the returns
 * repository as a `findOne`/`find` double for the upsert path and never exposes
 * a `query` on it — the seam this method uses.
 *
 * @module infrastructure/persistence/repositories
 */
import { ReturnRepository } from './return.repository';
import { ReturnPersistenceError } from '../../../domain/exceptions/return-persistence.error';

describe('ReturnRepository.updateOmsAttention (#2352)', () => {
  let query: jest.Mock;
  let repository: ReturnRepository;

  const calls = (): unknown[][] => query.mock.calls as unknown[][];
  const sql = (): string => String(calls()[0][0]);
  const params = (): unknown[] => calls()[0][1] as unknown[];

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    repository = new ReturnRepository(
      { query } as never,
      { find: jest.fn() } as never,
      // The line-event repository (#2380) — unused by this write, but a
      // positional constructor argument since the returns-custody body.
      { find: jest.fn() } as never,
      { transaction: jest.fn() } as never
    );
  });

  it('should not touch the database at all when the producer is indeterminate', async () => {
    // Clearing on a transient failure erases a true reason and replaces it with
    // silence, which is worse than a stale one (#2100).
    await repository.updateOmsAttention('ol_return_x', 'returns-restock', {
      kind: 'indeterminate',
    });

    expect(query).not.toHaveBeenCalled();
  });

  it('should send the reason and its optional fields when the producer reports blocked', async () => {
    await repository.updateOmsAttention('ol_return_x', 'returns-restock', {
      kind: 'blocked',
      reason: 'restock-blocked',
      detail: 'the shop refused',
      subjectRef: 'line-2',
    });

    expect(params()[0]).toBe('ol_return_x');
    expect(params()[1]).toBe('returns-restock');
    expect(JSON.parse(params()[2] as string)).toEqual({
      producer: 'returns-restock',
      reason: 'restock-blocked',
      detail: 'the shop refused',
      subjectRef: 'line-2',
    });
  });

  it('should send a null payload when the producer reports none', async () => {
    await repository.updateOmsAttention('ol_return_x', 'returns-restock', { kind: 'none' });

    expect(params()[2]).toBeNull();
  });

  // The statement's own clauses are specced once, against the shared builder
  // (`authority-attention-sql.types.spec.ts`) and behaviourally against real
  // Postgres (`apps/api/test/integration/oms-attention.int-spec.ts`). What is
  // this repository's own responsibility is that it targets the RIGHT table.
  it('should run the shared statement against the returns table', async () => {
    await repository.updateOmsAttention('ol_return_x', 'returns-restock', { kind: 'none' });

    expect(sql()).toContain('FROM "returns"');
    expect(sql()).toContain('UPDATE "returns" r');
  });

  it('should wrap a driver failure in the context-owned persistence error', async () => {
    query.mockRejectedValue(new Error('connection reset'));

    await expect(
      repository.updateOmsAttention('ol_return_x', 'returns-restock', { kind: 'none' })
    ).rejects.toBeInstanceOf(ReturnPersistenceError);
  });
});
