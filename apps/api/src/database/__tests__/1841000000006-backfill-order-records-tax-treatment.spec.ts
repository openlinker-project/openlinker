/**
 * Backfill-`taxTreatment` Migration Unit Test
 *
 * Guards `1841000000006-backfill-order-records-tax-treatment.ts` (#2440).
 *
 * Nothing in CI executes a migration (the Testcontainers schema is built by
 * TypeORM `synchronize`), so the emitted SQL is the only artefact a runnable
 * test can observe — the same constraint
 * `1840000000000-reset-fx-stamp-for-mislabelled-prestashop-orders.spec.ts`
 * documents. This migration's `WHERE` clause is two plain predicates (a
 * platform allow-list and an idempotency guard), so — unlike that sibling's
 * five-arm damage predicate — a structural parser is disproportionate; this
 * spec asserts directly on the captured SQL string.
 *
 * LIVES HERE, NOT UNDER `migrations/__tests__/`: `data-source.ts`'s glob feeds
 * every matched file to the TypeORM CLI, which would `require()` a colocated
 * spec and crash on its first bare `describe()`.
 *
 * @module apps/api/src/database/__tests__
 */
import type { QueryRunner } from 'typeorm';
import { BackfillOrderRecordsTaxTreatment1841000000006 } from '../../migrations/1841000000006-backfill-order-records-tax-treatment';

describe('BackfillOrderRecordsTaxTreatment1841000000006', () => {
  describe('up', () => {
    it('scopes the UPDATE to prestashop and woocommerce connections only', async () => {
      const query = jest.fn().mockResolvedValue(undefined);
      const queryRunner = { query } as unknown as QueryRunner;

      await new BackfillOrderRecordsTaxTreatment1841000000006().up(queryRunner);

      expect(query).toHaveBeenCalledTimes(1);
      const [sql] = query.mock.calls[0] as [string];
      expect(sql).toMatch(/c\."platformType"\s+IN\s*\(\s*'prestashop'\s*,\s*'woocommerce'\s*\)/);
    });

    it('guards the write with the idempotency predicate (WHERE taxTreatment IS NULL)', async () => {
      const query = jest.fn().mockResolvedValue(undefined);
      const queryRunner = { query } as unknown as QueryRunner;

      await new BackfillOrderRecordsTaxTreatment1841000000006().up(queryRunner);

      const [sql] = query.mock.calls[0] as [string];
      expect(sql).toMatch(/o\."taxTreatment"\s+IS\s+NULL/);
    });

    it('joins on sourceConnectionId, never inferring the platform from the order row itself', async () => {
      const query = jest.fn().mockResolvedValue(undefined);
      const queryRunner = { query } as unknown as QueryRunner;

      await new BackfillOrderRecordsTaxTreatment1841000000006().up(queryRunner);

      const [sql] = query.mock.calls[0] as [string];
      expect(sql).toMatch(/c\."id"\s*=\s*o\."sourceConnectionId"/);
    });

    it('sets taxTreatment to exclusive, never any other value', async () => {
      const query = jest.fn().mockResolvedValue(undefined);
      const queryRunner = { query } as unknown as QueryRunner;

      await new BackfillOrderRecordsTaxTreatment1841000000006().up(queryRunner);

      const [sql] = query.mock.calls[0] as [string];
      expect(sql).toMatch(/SET\s+"taxTreatment"\s*=\s*'exclusive'/);
    });
  });

  describe('down', () => {
    it('is a deliberate no-op — never re-nulls a true fact about how a platform prices', async () => {
      const query = jest.fn();

      await new BackfillOrderRecordsTaxTreatment1841000000006().down();

      expect(query).not.toHaveBeenCalled();
    });
  });
});
