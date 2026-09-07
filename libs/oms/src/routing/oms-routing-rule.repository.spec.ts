/**
 * OMS Routing Rule Repository — unit tests (#2953)
 *
 * Covers the two behaviours that are decisions rather than plumbing and that a
 * real-Postgres int-spec would exercise only incidentally: the `recognised`
 * mapping, and the reorder's exhaustiveness refusal. The SQL predicates
 * themselves (the not-retired window, the partial unique index) belong to
 * `oms-routing-rules-api.int-spec.ts`, because a mocked query builder would
 * assert them back at itself.
 *
 * @module libs/oms/src/routing
 */
import {
  RoutingRuleReorderMismatchError,
} from './routing-rule-admin.errors';
import { OmsRoutingRuleRepository } from './oms-routing-rule.repository';
import type { OmsRoutingRuleOrmEntity } from './oms-routing-rule.orm-entity';

const CONNECTION_ID = 'conn-oms';

function row(overrides: Partial<OmsRoutingRuleOrmEntity> = {}): OmsRoutingRuleOrmEntity {
  return {
    id: 'rule-1',
    connectionId: CONNECTION_ID,
    position: 1,
    kind: 'filter',
    name: 'in-stock',
    afterAction: 'quantity-split',
    priorityLocationIds: [],
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as OmsRoutingRuleOrmEntity;
}

/** Minimal query-builder stub: only the chain the repository actually calls. */
function queryBuilderReturning(rows: OmsRoutingRuleOrmEntity[]): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'setLock']) {
    builder[method] = jest.fn().mockReturnValue(builder);
  }
  builder.getMany = jest.fn().mockResolvedValue(rows);
  return builder;
}

describe('OmsRoutingRuleRepository', () => {
  describe('recognised mapping', () => {
    it('should report recognised: true for a row this build can route on', async () => {
      const rules = {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilderReturning([row()])),
      };
      const repository = new OmsRoutingRuleRepository(rules as never);

      const [record] = await repository.listRules(CONNECTION_ID);

      expect(record.recognised).toBe(true);
      expect(record.name).toBe('in-stock');
    });

    it('should LIST an unrecognised row rather than dropping it, flagged recognised: false', async () => {
      // `listActiveRules` drops this row — correct, the router must not route on
      // a partial understanding. The admin list must NOT, or the row that is
      // silently not routing is also the row an operator cannot find to delete.
      const rules = {
        createQueryBuilder: jest
          .fn()
          .mockReturnValue(queryBuilderReturning([row({ name: 'method-capable' })])),
      };
      const repository = new OmsRoutingRuleRepository(rules as never);

      const records = await repository.listRules(CONNECTION_ID);

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ name: 'method-capable', recognised: false });
    });

    it('should drop a non-string entry from a malformed priorityLocationIds column', async () => {
      const rules = {
        createQueryBuilder: jest.fn().mockReturnValue(
          queryBuilderReturning([
            row({ kind: 'sort', name: 'priority', priorityLocationIds: ['loc-a', 7, null] }),
          ])
        ),
      };
      const repository = new OmsRoutingRuleRepository(rules as never);

      const [record] = await repository.listRules(CONNECTION_ID);
      expect(record.priorityLocationIds).toEqual(['loc-a']);
    });
  });

  describe('updateRule', () => {
    function repositoryWithRow(stored: OmsRoutingRuleOrmEntity): {
      repository: OmsRoutingRuleRepository;
      update: jest.Mock;
    } {
      const update = jest.fn().mockResolvedValue({ affected: 1 });
      const rules = { findOne: jest.fn().mockResolvedValue(stored), update };
      return { repository: new OmsRoutingRuleRepository(rules as never), update };
    }

    /** The column set of the Nth `update` call, typed so the assertions are not `any`. */
    function updatedColumns(update: jest.Mock, call = 0): Record<string, unknown> {
      return (update.mock.calls[call] as unknown[])[1] as Record<string, unknown>;
    }

    it('should UPDATE only the patched columns, never write back an unpatched position', async () => {
      // `position` has two writers (this method and `reorderRules`), so a
      // full-row save would carry the position read BEFORE a concurrent reorder
      // and silently undo part of it. Asserting the exact column set is what
      // catches a regression back to `save(row)`.
      const { repository, update } = repositoryWithRow(row({ position: 7 }));

      await repository.updateRule(CONNECTION_ID, 'rule-1', { name: 'country-served' });

      expect(update).toHaveBeenCalledWith(
        { id: 'rule-1', connectionId: CONNECTION_ID },
        { name: 'country-served' }
      );
      expect(updatedColumns(update)).not.toHaveProperty('position');
    });

    it('should treat an explicit null as a clear and an absent key as untouched', async () => {
      const { repository, update } = repositoryWithRow(
        row({ effectiveFrom: new Date('2026-10-01T00:00:00.000Z') })
      );

      await repository.updateRule(CONNECTION_ID, 'rule-1', { effectiveTo: null });

      expect(updatedColumns(update)).toEqual({ effectiveTo: null });
    });

    it('should issue no UPDATE at all for an empty patch', async () => {
      // TypeORM rejects an empty update set, and an empty patch is a legitimate
      // no-op request rather than an error.
      const { repository, update } = repositoryWithRow(row());

      await expect(repository.updateRule(CONNECTION_ID, 'rule-1', {})).resolves.toBeDefined();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('reorderRules', () => {
    function repositoryWithTransactionRows(
      rows: OmsRoutingRuleOrmEntity[]
    ): { repository: OmsRoutingRuleRepository; update: jest.Mock } {
      const update = jest.fn().mockResolvedValue({ affected: 1 });
      const manager = {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilderReturning(rows)),
        update,
      };
      type TransactionWork = (manager: unknown) => Promise<unknown>;
      const rules = {
        manager: {
          transaction: jest
            .fn()
            .mockImplementation((work: TransactionWork) => work(manager)),
        },
      };
      return { repository: new OmsRoutingRuleRepository(rules as never), update };
    }

    it('should renumber to a dense 1..N in the requested order', async () => {
      const { repository, update } = repositoryWithTransactionRows([
        row({ id: 'a', position: 5 }),
        row({ id: 'b', position: 9 }),
      ]);

      await repository.reorderRules(CONNECTION_ID, ['b', 'a']);

      expect(update).toHaveBeenNthCalledWith(1, expect.anything(), { id: 'b', connectionId: CONNECTION_ID }, { position: 1 });
      expect(update).toHaveBeenNthCalledWith(2, expect.anything(), { id: 'a', connectionId: CONNECTION_ID }, { position: 2 });
    });

    it('should refuse and write nothing when the list omits an active rule', async () => {
      const { repository, update } = repositoryWithTransactionRows([
        row({ id: 'a' }),
        row({ id: 'b' }),
      ]);

      await expect(repository.reorderRules(CONNECTION_ID, ['a'])).rejects.toThrow(
        RoutingRuleReorderMismatchError
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('should report the missing and unknown ids separately', async () => {
      const { repository } = repositoryWithTransactionRows([row({ id: 'a' })]);

      await expect(
        repository.reorderRules(CONNECTION_ID, ['ghost'])
      ).rejects.toMatchObject({
        missingRuleIds: ['a'],
        unknownRuleIds: ['ghost'],
      });
    });

    it('should refuse a list that repeats an id', async () => {
      // A repeat shrinks the requested SET without producing an unknown id, so
      // the set comparison alone would pass while renumbering fewer rules than
      // the caller listed. Length equality is what catches it.
      const { repository, update } = repositoryWithTransactionRows([
        row({ id: 'a' }),
        row({ id: 'b' }),
      ]);

      await expect(repository.reorderRules(CONNECTION_ID, ['a', 'a'])).rejects.toThrow(
        RoutingRuleReorderMismatchError
      );
      expect(update).not.toHaveBeenCalled();
    });
  });
});
