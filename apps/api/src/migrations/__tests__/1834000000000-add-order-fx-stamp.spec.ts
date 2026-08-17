/**
 * FX Snapshot Migration Unit Tests
 *
 * Guards the DDL of `1834000000000-add-order-fx-stamp.ts` (#2124).
 *
 * WHY THIS EXISTS AT ALL: nothing in CI or in the test harness executes a
 * migration — the Testcontainers schema is built by TypeORM `synchronize`
 * (`docs/testing-guide.md`), so no integration test can observe a CHECK
 * constraint this file adds. An int-spec would therefore assert against a
 * schema that never carries the constraint. The `up()` SQL is the only artefact
 * available to a runnable test, so the group CHECK is verified by parsing the
 * emitted constraint expression and evaluating it against each of the five
 * legal FX states plus the one illegal combination it exists to reject. The
 * live `run → revert → run` round-trip stays a manual gate.
 *
 * @module apps/api/src/migrations/__tests__
 */
import type { QueryRunner } from 'typeorm';
import { AddOrderFxStamp1834000000000 } from '../1834000000000-add-order-fx-stamp';

/** The six FX columns as a row shape the CHECK can be evaluated against. */
interface FxRow {
  reportingCurrency: string | null;
  reportingTotalAmount: number | null;
  exchangeRateId: string | null;
  fxRule: string | null;
  fxStampedAt: Date | null;
  fxIntendedCurrency: string | null;
}

const EMPTY_ROW: FxRow = {
  reportingCurrency: null,
  reportingTotalAmount: null,
  exchangeRateId: null,
  fxRule: null,
  fxStampedAt: null,
  fxIntendedCurrency: null,
};

/**
 * One `"column" IS [NOT] NULL` test parsed out of the constraint text.
 * Deliberately structural rather than `eval`-based: the constraint is a
 * conjunction of null tests inside a disjunction of two arms, so a tiny parser
 * evaluates the REAL SQL text without executing anything.
 */
interface NullTest {
  column: keyof FxRow;
  mustBeNull: boolean;
}

const parseArms = (checkExpression: string): NullTest[][] => {
  const armBodies = [...checkExpression.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
  return armBodies.map((body) =>
    body
      .split(/\bAND\b/)
      .map((clause) => clause.trim())
      .filter((clause) => clause.length > 0)
      .map((clause) => {
        const match = /^"(\w+)"\s+IS\s+(NOT\s+)?NULL$/.exec(clause);
        if (!match) {
          throw new Error(`unparsable CHECK clause: ${clause}`);
        }
        return { column: match[1] as keyof FxRow, mustBeNull: match[2] === undefined };
      })
  );
};

const evaluate = (arms: NullTest[][], row: FxRow): boolean =>
  arms.some((arm) => arm.every(({ column, mustBeNull }) => (row[column] === null) === mustBeNull));

describe('AddOrderFxStamp1834000000000', () => {
  let queryRunner: QueryRunner;
  let statements: string[];

  const collect = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new AddOrderFxStamp1834000000000();
    await migration[direction](queryRunner);
    return statements;
  };

  /**
   * Whitespace-normalised join, so the assertions below test the DDL rather
   * than the column alignment inside the template literals.
   */
  const collectSql = async (direction: 'up' | 'down'): Promise<string> =>
    (await collect(direction)).join('\n').replace(/\s+/g, ' ');

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
    it('should create exchange_rates with its natural-key unique index', async () => {
      const sql = await collectSql('up');

      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "exchange_rates"');
      expect(sql).toContain('"rate" numeric(18,8) NOT NULL');
      expect(sql).toContain('"derivation" jsonb NOT NULL');
      expect(sql).toContain('"fetchedAt" timestamptz NOT NULL DEFAULT now()');
      expect(sql).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_exchange_rates_key" ON "exchange_rates" ("source", "fromCurrency", "toCurrency", "rateDate")'
      );
      expect(sql).toContain(`CHECK ("source" IN ('nbp', 'ecb'))`);
    });

    it('should create reporting_currency_setting with snake_case columns', async () => {
      const sql = await collectSql('up');

      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "reporting_currency_setting"');
      expect(sql).toContain('"reporting_currency" varchar(3) NOT NULL');
      expect(sql).toContain('CONSTRAINT "PK_reporting_currency_setting" PRIMARY KEY ("id")');
    });

    it('should add all six FX columns as nullable', async () => {
      const sql = await collectSql('up');

      const expected: Array<[string, string]> = [
        ['reportingCurrency', 'varchar(3)'],
        ['reportingTotalAmount', 'numeric(12,2)'],
        ['exchangeRateId', 'uuid'],
        ['fxRule', 'varchar(32)'],
        ['fxStampedAt', 'timestamptz'],
        ['fxIntendedCurrency', 'varchar(3)'],
      ];
      for (const [column, type] of expected) {
        const statement = `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "${column}" ${type}`;
        expect(sql).toContain(statement);
        // Nullable: no NOT NULL and no DEFAULT anywhere on the column's line.
        expect(sql).not.toContain(`${statement} NOT NULL`);
      }
    });

    it('should not put a foreign key or an index on exchangeRateId', async () => {
      const sql = await collectSql('up');

      expect(sql).not.toContain('REFERENCES "exchange_rates"');
      expect(sql).not.toContain('("exchangeRateId")');
    });

    it('should create the reporting index as a PARTIAL composite', async () => {
      const sql = await collectSql('up');

      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_order_records_reporting"');
      expect(sql).toContain('ON "order_records" ("sourceConnectionId", "reportingCurrency")');
      expect(sql).toContain('WHERE "reportingCurrency" IS NOT NULL');
    });

    it('should create the native-currency expression index with the jsonb_typeof guard', async () => {
      // Must match OrderRecordRepository.NATIVE_CURRENCY_EXPR modulo the table
      // alias, or the planner can never use it.
      const sql = await collectSql('up');

      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_order_records_snapshot_currency"');
      expect(sql).toContain(`jsonb_typeof("orderSnapshot"#>'{totals,currency}') = 'string'`);
      expect(sql).toContain(`THEN "orderSnapshot"#>>'{totals,currency}' END`);
    });

    it('should add both CHECK constraints, each preceded by a DROP IF EXISTS so up() is re-runnable', async () => {
      const sql = await collectSql('up');

      for (const name of ['ck_order_records_fx_group', 'ck_order_records_fx_rule']) {
        expect(sql).toContain(`ALTER TABLE "order_records" DROP CONSTRAINT IF EXISTS "${name}"`);
        expect(sql).toContain(`ADD CONSTRAINT "${name}" CHECK (`);
      }
      expect(sql).toContain(`"fxRule" IS NULL OR "fxRule" IN ('prev-business-day')`);
    });
  });

  describe('ck_order_records_fx_group', () => {
    let arms: NullTest[][];

    beforeEach(async () => {
      const groupStatement = (await collect('up')).find((sql) =>
        sql.includes('ADD CONSTRAINT "ck_order_records_fx_group"')
      );
      expect(groupStatement).toBeDefined();
      const expression = /CHECK\s*\(([\s\S]*)\)/.exec(groupStatement as string)?.[1];
      expect(expression).toBeDefined();
      arms = parseArms(expression as string);
    });

    it('should parse into exactly two arms', () => {
      expect(arms).toHaveLength(2);
    });

    it('should NOT require fxRule IS NULL in the unstamped arm (load-bearing omission)', () => {
      // The intent claim writes fxRule while reportingCurrency is still NULL.
      // Requiring it here would reject every intent row and make the snapshot
      // unimplementable — this assertion is the guard against "tidying" it up.
      expect(arms[0].some((test) => test.column === 'fxRule')).toBe(false);
      expect(arms[0].some((test) => test.column === 'fxIntendedCurrency')).toBe(false);
    });

    it('should accept "never attempted" (all six NULL)', () => {
      expect(evaluate(arms, EMPTY_ROW)).toBe(true);
    });

    it('should accept "attempted, deferred to the retry job"', () => {
      expect(
        evaluate(arms, {
          ...EMPTY_ROW,
          fxRule: 'prev-business-day',
          fxIntendedCurrency: 'EUR',
        })
      ).toBe(true);
    });

    it('should accept "terminal" (stamp attempt closed without a conversion)', () => {
      expect(
        evaluate(arms, {
          ...EMPTY_ROW,
          fxRule: 'prev-business-day',
          fxStampedAt: new Date('2026-08-14T09:00:00Z'),
          fxIntendedCurrency: 'EUR',
        })
      ).toBe(true);
    });

    it('should accept "stamped, same currency" (exchangeRateId NULL)', () => {
      expect(
        evaluate(arms, {
          reportingCurrency: 'EUR',
          reportingTotalAmount: 100,
          exchangeRateId: null,
          fxRule: 'prev-business-day',
          fxStampedAt: new Date('2026-08-14T09:00:00Z'),
          fxIntendedCurrency: 'EUR',
        })
      ).toBe(true);
    });

    it('should accept "stamped, converted"', () => {
      expect(
        evaluate(arms, {
          reportingCurrency: 'EUR',
          reportingTotalAmount: 425,
          exchangeRateId: 'e1f0c0de-0000-4000-8000-000000000001',
          fxRule: 'prev-business-day',
          fxStampedAt: new Date('2026-08-14T09:00:00Z'),
          fxIntendedCurrency: 'EUR',
        })
      ).toBe(true);
    });

    it('should reject a reportingCurrency carrying no reportingTotalAmount', () => {
      expect(
        evaluate(arms, {
          ...EMPTY_ROW,
          reportingCurrency: 'EUR',
          fxRule: 'prev-business-day',
          fxStampedAt: new Date('2026-08-14T09:00:00Z'),
          fxIntendedCurrency: 'EUR',
        })
      ).toBe(false);
    });

    it('should reject an amount stamped without a currency to interpret it in', () => {
      expect(
        evaluate(arms, {
          ...EMPTY_ROW,
          reportingTotalAmount: 425,
          fxRule: 'prev-business-day',
        })
      ).toBe(false);
    });

    it('should reject a stamp carrying no fxRule', () => {
      expect(
        evaluate(arms, {
          reportingCurrency: 'EUR',
          reportingTotalAmount: 425,
          exchangeRateId: 'e1f0c0de-0000-4000-8000-000000000001',
          fxRule: null,
          fxStampedAt: new Date('2026-08-14T09:00:00Z'),
          fxIntendedCurrency: 'EUR',
        })
      ).toBe(false);
    });
  });

  describe('down', () => {
    it('should drop everything up() created, guarded with IF EXISTS', async () => {
      const sql = await collectSql('down');

      expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ck_order_records_fx_rule"');
      expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ck_order_records_fx_group"');
      expect(sql).toContain('DROP INDEX IF EXISTS "IDX_order_records_snapshot_currency"');
      expect(sql).toContain('DROP INDEX IF EXISTS "IDX_order_records_reporting"');
      for (const column of [
        'reportingCurrency',
        'reportingTotalAmount',
        'exchangeRateId',
        'fxRule',
        'fxStampedAt',
        'fxIntendedCurrency',
      ]) {
        expect(sql).toContain(`DROP COLUMN IF EXISTS "${column}"`);
      }
      expect(sql).toContain('DROP TABLE IF EXISTS "reporting_currency_setting"');
      expect(sql).toContain('DROP INDEX IF EXISTS "UQ_exchange_rates_key"');
      expect(sql).toContain('DROP TABLE IF EXISTS "exchange_rates"');
    });

    it('should drop the constraints before the columns they reference', async () => {
      const emitted = await collect('down');
      const constraintIndex = emitted.findIndex((sql) =>
        sql.includes('"ck_order_records_fx_group"')
      );
      const columnIndex = emitted.findIndex((sql) =>
        sql.includes('DROP COLUMN IF EXISTS "reportingCurrency"')
      );

      expect(constraintIndex).toBeGreaterThanOrEqual(0);
      expect(columnIndex).toBeGreaterThan(constraintIndex);
    });
  });
});
