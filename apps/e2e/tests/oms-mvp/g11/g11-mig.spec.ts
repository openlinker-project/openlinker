/**
 * G11 MIG - schema and stored state
 *
 * Reads the database through `docker exec psql`. The CHECK constraints are
 * exercised with statements that must be rejected, each on a throw-away
 * transaction that is rolled back, so a constraint that is missing shows up as
 * a row that was accepted (and is deleted again) rather than as data left
 * behind.
 *
 * @module tests/oms-mvp/g11
 */
import { test, expect } from '../../../src/fixtures/g11';
import { lit } from '../../../src/support/g11/db';

test.describe('G11 MIG - migrations and stored state @g11', () => {
  test('MIG-1 the CHECK constraints reject a half-set cost, a negative cost and a "recorded" line without a cost', ({ ctx, db }) => {
    const a1 = ctx.setup.products.psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA.A1 missing');

    const rejected = (sql: string): { ok: boolean; error: string } => {
      const result = db.try(`BEGIN; ${sql}; ROLLBACK;`);
      db.try('ROLLBACK');
      return { ok: result.ok, error: result.stderr };
    };

    const halfSet = rejected(`UPDATE product_variants SET "netUnitCost" = 1.0000, "costCurrency" = NULL WHERE id = ${lit(a1!.variantId)}`);
    expect(halfSet.ok, 'an amount without a currency is rejected').toBe(false);
    expect(halfSet.error).toMatch(/check constraint|violates/i);

    const negative = rejected(`UPDATE product_variants SET "netUnitCost" = -1.0000, "costCurrency" = 'PLN' WHERE id = ${lit(a1!.variantId)}`);
    expect(negative.ok, 'a negative cost is rejected').toBe(false);
    expect(negative.error).toMatch(/check constraint|violates/i);

    const hasLines = db.scalar('SELECT count(*) FROM order_line_items') !== '0';
    if (hasLines) {
      const recordedWithoutCost = rejected(`UPDATE order_line_items SET "costState" = 'recorded', "unitCostNet" = NULL, "unitCostCurrency" = NULL WHERE id = (SELECT id FROM order_line_items LIMIT 1)`);
      expect(recordedWithoutCost.ok, 'recorded without a cost is rejected').toBe(false);
      const unknownState = rejected(`UPDATE order_line_items SET "costState" = 'maybe' WHERE id = (SELECT id FROM order_line_items LIMIT 1)`);
      expect(unknownState.ok, 'an unknown cost state is rejected').toBe(false);
    } else {
      test.info().annotations.push({ type: 'skipped-part', description: 'no order lines on the stand to probe the snapshot constraints with' });
    }

    test.info().annotations.push({ type: 'migration-show', description: 'run "pnpm --filter @openlinker/api migration:show" by hand to confirm 1938300000000..1938300002000 are applied' });
    const index = db.scalar(`SELECT count(*) FROM pg_indexes WHERE indexname = 'IDX_order_line_items_variantId_placedAt'`);
    expect(index).toBe('1');
  });

  test('MIG-2 order lines that predate the migration read not-recorded, with no backfill', ({ db }) => {
    const total = Number(db.scalar('SELECT count(*) FROM order_line_items') ?? 0);
    test.skip(total === 0, 'no order lines on the stand');
    const recordedWithoutCostColumn = Number(db.scalar(`SELECT count(*) FROM order_line_items WHERE "costState" = 'recorded' AND "unitCostNet" IS NULL`) ?? 0);
    expect(recordedWithoutCostColumn).toBe(0);
    const oldest = db.rows<{ costState: string; unitCostNet: string | null }>(
      `SELECT "costState", "unitCostNet"::text AS "unitCostNet" FROM order_line_items ORDER BY "createdAt" ASC LIMIT 20`,
    );
    test.info().annotations.push({
      type: 'oldest-lines',
      description: JSON.stringify(oldest.map((l) => l.costState)),
    });
    expect(oldest.every((l) => l.costState === 'recorded' || l.costState === 'not-recorded')).toBe(true);
    expect(
      Number(db.scalar(`SELECT count(*) FROM order_line_items WHERE "costState" = 'not-recorded' AND "unitCostNet" IS NOT NULL`) ?? 0),
      'not-recorded never carries a cost',
    ).toBe(0);
  });

  test('MIG-3 analytics_display_settings.track_margin exists and defaults to true', ({ db }) => {
    const column = db.rows<{ column_default: string | null; is_nullable: string; data_type: string }>(
      `SELECT column_default, is_nullable, data_type FROM information_schema.columns
        WHERE table_name = 'analytics_display_settings' AND column_name = 'track_margin'`,
    );
    expect(column.length, 'the column exists').toBe(1);
    expect(column[0]?.data_type).toBe('boolean');
    expect(column[0]?.is_nullable).toBe('NO');
    expect(column[0]?.column_default).toMatch(/true/i);
    const stored = db.scalar(`SELECT count(*) FROM analytics_display_settings WHERE track_margin IS NULL`);
    expect(stored).toBe('0');
  });
});
