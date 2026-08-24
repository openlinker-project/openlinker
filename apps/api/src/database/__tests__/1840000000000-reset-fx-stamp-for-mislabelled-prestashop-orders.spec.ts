/**
 * FX-Stamp Reset Migration Unit Tests
 *
 * Guards the `WHERE` clause of
 * `1840000000000-reset-fx-stamp-for-mislabelled-prestashop-orders.ts` (#2277).
 *
 * WHY THIS EXISTS AT ALL: the migration's central safety property - that running
 * it BEFORE the corrected code has re-polled is a no-op rather than damage - is
 * carried entirely by one predicate arm (`snapshot currency <> 'EUR'`). Deleting
 * that arm still produces a migration that runs, passes review by looking
 * plausible, and quietly re-opens every already-correct stamp for recomputation
 * from a snapshot that still says EUR. A comment cannot fail a build; this can.
 *
 * The approach is the one `1836000000000-add-order-fx-stamp.spec.ts` established
 * and its header explains: nothing in CI executes a migration (the Testcontainers
 * schema is built by TypeORM `synchronize`), so the emitted SQL is the only
 * artefact a runnable test can observe. The `WHERE` body is therefore parsed out
 * of the REAL statement and evaluated against row fixtures - structurally, never
 * with `eval`.
 *
 * LIVES HERE, NOT UNDER `migrations/__tests__/`: `data-source.ts`'s glob feeds
 * every matched file to the TypeORM CLI, which would `require()` a colocated
 * spec and crash on its first bare `describe()`. See the sibling spec's header.
 *
 * @module apps/api/src/database/__tests__
 */
import type { QueryRunner } from 'typeorm';
import { ResetFxStampForMislabelledPrestashopOrders1840000000000 } from '../../migrations/1840000000000-reset-fx-stamp-for-mislabelled-prestashop-orders';

/** The six FX columns the migration clears, as the ADR-040 table names them. */
const FX_COLUMNS = [
  'reportingCurrency',
  'reportingTotalAmount',
  'exchangeRateId',
  'fxStampedAt',
  'fxIntendedCurrency',
  'fxRule',
] as const;

/**
 * A candidate `order_records` row, reduced to the three facts the predicate
 * actually reads. `snapshotCurrency` is deliberately `unknown`: a malformed
 * snapshot value is one of the cases the `jsonb_typeof` guard exists for, so the
 * fixture has to be able to carry a non-string.
 */
interface CandidateRow {
  platformType: string;
  reportingCurrency: string | null;
  snapshotCurrency: unknown;
  /**
   * `fromCurrency` of the `exchange_rates` row the stamp points at, or `null`
   * when the stamp took the same-currency short-circuit and wrote no rate.
   */
  exchangeRateFromCurrency: string | null;
}

type ClausePredicate = (row: CandidateRow) => boolean;

/**
 * Translate one parsed `WHERE` clause into a predicate over a fixture row.
 *
 * Every clause the migration emits must be recognised here. An unrecognised one
 * throws rather than being skipped - a silently-ignored arm would let this spec
 * keep passing over a predicate it no longer describes, which is the failure
 * mode the whole file exists to prevent.
 */
const toPredicate = (clause: string): ClausePredicate => {
  if (/^c\."id"\s*=\s*o\."sourceConnectionId"$/.test(clause)) {
    // The join condition; every fixture row is already a joined pair.
    return () => true;
  }
  const platform = /^c\."platformType"\s*=\s*'([^']+)'$/.exec(clause);
  if (platform) {
    return (row) => row.platformType === platform[1];
  }
  if (/^o\."reportingCurrency"\s+IS\s+NOT\s+NULL$/.test(clause)) {
    return (row) => row.reportingCurrency !== null;
  }
  if (/^jsonb_typeof\(o\."orderSnapshot"#>'\{totals,currency\}'\)\s*=\s*'string'$/.test(clause)) {
    return (row) => typeof row.snapshotCurrency === 'string';
  }
  const damage =
    /^\(\(o\."exchangeRateId" IS NULL AND o\."reportingCurrency" = '([^']+)'\) OR EXISTS \(SELECT 1 FROM "exchange_rates" er WHERE er\."id" = o\."exchangeRateId" AND er\."fromCurrency" = '([^']+)'\)\)$/.exec(
      clause
    );
  if (damage) {
    const [, shortCircuitCurrency, ratedFromCurrency] = damage;
    return (row) =>
      (row.exchangeRateFromCurrency === null && row.reportingCurrency === shortCircuitCurrency) ||
      row.exchangeRateFromCurrency === ratedFromCurrency;
  }
  const notEqual = /^o\."orderSnapshot"#>>'\{totals,currency\}'\s*<>\s*'([^']+)'$/.exec(clause);
  if (notEqual) {
    // SQL three-valued logic: a NULL extraction makes `<>` UNKNOWN, not true.
    return (row) =>
      typeof row.snapshotCurrency === 'string' && row.snapshotCurrency !== notEqual[1];
  }
  throw new Error(`unparsable WHERE clause: ${clause}`);
};

/**
 * Split on `AND` at parenthesis depth 0 only. The damage clause is itself a
 * parenthesised disjunction containing an `AND` and a subquery, so a naive
 * split would shred it into fragments that then look unparsable.
 */
const splitTopLevelAnd = (body: string): string[] => {
  const clauses: string[] = [];
  let depth = 0;
  let current = '';
  const tokens = body.split(/(\(|\)|\bAND\b)/);
  for (const token of tokens) {
    if (token === '(') {
      depth += 1;
      current += token;
    } else if (token === ')') {
      depth -= 1;
      current += token;
    } else if (token === 'AND' && depth === 0) {
      clauses.push(current);
      current = '';
    } else {
      current += token;
    }
  }
  clauses.push(current);
  return clauses.map((clause) => clause.trim()).filter((clause) => clause.length > 0);
};

const parseWhere = (sql: string): ClausePredicate[] => {
  const body = /\bWHERE\b([\s\S]*)$/.exec(sql);
  if (!body) {
    throw new Error('migration emitted no WHERE clause');
  }
  return splitTopLevelAnd(body[1]).map(toPredicate);
};

const matches = (predicates: ClausePredicate[], row: CandidateRow): boolean =>
  predicates.every((predicate) => predicate(row));

describe('ResetFxStampForMislabelledPrestashopOrders1840000000000', () => {
  let queryRunner: QueryRunner;
  let statements: string[];

  const collectSql = async (direction: 'up' | 'down'): Promise<string> => {
    const migration = new ResetFxStampForMislabelledPrestashopOrders1840000000000();
    await migration[direction](queryRunner);
    return statements.join('\n').replace(/\s+/g, ' ').trim();
  };

  beforeEach(() => {
    statements = [];
    queryRunner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve(undefined);
      }),
    } as unknown as QueryRunner;
  });

  describe('up', () => {
    it('should clear every one of the six FX columns', async () => {
      const sql = await collectSql('up');

      for (const column of FX_COLUMNS) {
        expect(sql).toContain(`"${column}" = NULL`);
      }
    });

    it('should target order_records joined to its source connection', async () => {
      const sql = await collectSql('up');

      expect(sql).toContain('UPDATE "order_records" o');
      expect(sql).toContain('FROM "connections" c');
    });

    it('should match a PrestaShop order whose snapshot currency has been corrected', async () => {
      const predicates = parseWhere(await collectSql('up'));

      expect(
        matches(predicates, {
          platformType: 'prestashop',
          reportingCurrency: 'PLN',
          snapshotCurrency: 'PLN',
          exchangeRateFromCurrency: 'EUR',
        })
      ).toBe(true);
    });

    it('should be a no-op when run before the corrected code has re-polled', async () => {
      const predicates = parseWhere(await collectSql('up'));

      // The order-of-deployment guarantee. A row still reading EUR would only be
      // re-stamped from that same wrong snapshot and re-closed, permanently.
      expect(
        matches(predicates, {
          platformType: 'prestashop',
          reportingCurrency: 'PLN',
          snapshotCurrency: 'EUR',
          exchangeRateFromCurrency: 'EUR',
        })
      ).toBe(false);
    });

    it('should leave an unstamped order alone', async () => {
      const predicates = parseWhere(await collectSql('up'));

      expect(
        matches(predicates, {
          platformType: 'prestashop',
          reportingCurrency: null,
          snapshotCurrency: 'PLN',
          exchangeRateFromCurrency: 'EUR',
        })
      ).toBe(false);
    });

    it('should leave an order from another source platform alone', async () => {
      const predicates = parseWhere(await collectSql('up'));

      expect(
        matches(predicates, {
          platformType: 'allegro',
          reportingCurrency: 'PLN',
          snapshotCurrency: 'PLN',
          exchangeRateFromCurrency: 'EUR',
        })
      ).toBe(false);
    });

    it('should skip a row whose snapshot currency is not a JSON string', async () => {
      const predicates = parseWhere(await collectSql('up'));

      for (const snapshotCurrency of [null, 42, { code: 'PLN' }]) {
        expect(
          matches(predicates, {
            platformType: 'prestashop',
            reportingCurrency: 'PLN',
            snapshotCurrency,
            exchangeRateFromCurrency: 'EUR',
          })
        ).toBe(false);
      }
    });

    it('should match the same-currency short-circuit on a EUR-reporting deployment', async () => {
      const predicates = parseWhere(await collectSql('up'));

      // No rate row was written because native and reporting currency both read
      // EUR - so the PLN total was copied across verbatim, unconverted.
      expect(
        matches(predicates, {
          platformType: 'prestashop',
          reportingCurrency: 'EUR',
          snapshotCurrency: 'PLN',
          exchangeRateFromCurrency: null,
        })
      ).toBe(true);
    });

    it('should leave a stamp that was already derived from the real currency alone', async () => {
      const predicates = parseWhere(await collectSql('up'));

      // Observed live: an order ingested after the fix, carrying a PLN->EUR rate
      // and the correct converted total. The snapshot test alone matched it.
      expect(
        matches(predicates, {
          platformType: 'prestashop',
          reportingCurrency: 'EUR',
          snapshotCurrency: 'PLN',
          exchangeRateFromCurrency: 'PLN',
        })
      ).toBe(false);
    });
  });

  describe('down', () => {
    it('should issue no statement, because the discarded figures are unrecoverable', async () => {
      await collectSql('down');

      expect(queryRunner.query).not.toHaveBeenCalled();
    });
  });
});
