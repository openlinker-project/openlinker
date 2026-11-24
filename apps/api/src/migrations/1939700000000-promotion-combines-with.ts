/**
 * Promotions: `combinable` becomes `combinesWith` (#3935, ADR-084 amendment).
 *
 * `combinable boolean` becomes `combinesWith jsonb`, a discriminated union
 * `{mode:'all'} | {mode:'none'} | {mode:'selected', promotionIds}`. true -> all,
 * false -> none. The definition hash covers the combination, so every hash is
 * recomputed here (the canonicalisation is COPIED, not imported: a migration
 * must keep meaning what it meant when it ran).
 *
 * `down()` is LOSSY: all -> true, none -> false, selected -> false (the
 * strictest reading, so a rollback never stacks what the operator limited).
 * The selected id lists are not recoverable afterwards.
 *
 * Generated: 2026-11-10 (synthetic sequential prefix per docs/migrations.md rule 3).
 */
import { createHash } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (typeof value !== 'object' || value === null) return value;
  const source = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) ordered[key] = withSortedKeys(source[key]);
  return ordered;
}

function hashOf(
  conditions: unknown[],
  benefit: unknown,
  combination: { key: 'combinable' | 'combinesWith'; value: unknown },
  limits: { unitCap: number | null; customerLimit: number | null }
): string {
  const sorted = conditions
    .map(withSortedKeys)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256')
    .update(
      JSON.stringify({
        conditions: sorted,
        benefit: withSortedKeys(benefit),
        [combination.key]: combination.value,
        limits: withSortedKeys(limits),
      })
    )
    .digest('hex');
}

interface Row {
  id: string;
  conditions: unknown[];
  benefit: unknown;
  unitCap: number | null;
  customerLimit: number | null;
}

export class PromotionCombinesWith1939700000000 implements MigrationInterface {
  name = 'PromotionCombinesWith1939700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "promotions" ADD COLUMN "combinesWith" jsonb`);
    await queryRunner.query(
      `UPDATE "promotions"
          SET "combinesWith" = CASE WHEN "combinable" THEN '{"mode":"all"}'::jsonb ELSE '{"mode":"none"}'::jsonb END`
    );
    await queryRunner.query(`ALTER TABLE "promotions" ALTER COLUMN "combinesWith" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "promotions" ALTER COLUMN "combinesWith" SET DEFAULT '{"mode":"all"}'`);

    const rows = (await queryRunner.query(
      `SELECT "id","conditions","benefit","unitCap","customerLimit","combinesWith" FROM "promotions"`
    )) as Array<Row & { combinesWith: { mode: string } }>;
    for (const row of rows) {
      const hash = hashOf(
        row.conditions,
        row.benefit,
        { key: 'combinesWith', value: row.combinesWith },
        { unitCap: row.unitCap, customerLimit: row.customerLimit }
      );
      await queryRunner.query(`UPDATE "promotions" SET "definitionHash" = $1 WHERE "id" = $2`, [hash, row.id]);
    }
    await queryRunner.query(`ALTER TABLE "promotions" DROP COLUMN "combinable"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "promotions" ADD COLUMN "combinable" boolean NOT NULL DEFAULT true`);
    // Lossy: only `all` stays combinable; `selected` reads as false (see the header).
    await queryRunner.query(`UPDATE "promotions" SET "combinable" = ("combinesWith"->>'mode' = 'all')`);
    const rows = (await queryRunner.query(
      `SELECT "id","conditions","benefit","unitCap","customerLimit","combinable" FROM "promotions"`
    )) as Array<Row & { combinable: boolean }>;
    for (const row of rows) {
      const hash = hashOf(
        row.conditions,
        row.benefit,
        { key: 'combinable', value: row.combinable },
        { unitCap: row.unitCap, customerLimit: row.customerLimit }
      );
      await queryRunner.query(`UPDATE "promotions" SET "definitionHash" = $1 WHERE "id" = $2`, [hash, row.id]);
    }
    await queryRunner.query(`ALTER TABLE "promotions" DROP COLUMN "combinesWith"`);
  }
}
