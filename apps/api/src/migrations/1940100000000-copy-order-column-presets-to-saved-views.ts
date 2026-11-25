/**
 * Copy the orders column presets (#3633) into `saved_views` (#4241)
 *
 * `page_key = 'orders'`: a user's presets become personal views, the single
 * workspace-default row (`userId IS NULL`) becomes a shared view flagged as the
 * workspace default. Columns are narrowed to the orders LIST column ids
 * (presets are shared with the export dialog and may carry export-only ids); a
 * preset with no list column left is skipped, as a view with no columns would
 * show nothing. Presets whose author no longer exists are skipped (the table had
 * no FK, so orphans can exist). Idempotent: `ON CONFLICT DO NOTHING` over the
 * name indexes. The source table is left untouched - the export dialog still
 * reads it.
 *
 * `down()` deletes the rows this copy can have produced: shared views flagged
 * as workspace default and personal views, on page `orders`, whose name and
 * columns still equal a source preset. A view the user has since edited no
 * longer matches and is KEPT - honest about not being able to tell, rather than
 * deleting user work.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CopyOrderColumnPresetsToSavedViews1940100000000 implements MigrationInterface {
  name = 'CopyOrderColumnPresetsToSavedViews1940100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The migration may run on a database where the presets table was never
    // created under this chain; nothing to copy then.
    const exists = (await queryRunner.query(
      `SELECT to_regclass('public.order_column_presets') IS NOT NULL AS present`
    )) as { present: boolean }[];
    if (!exists[0]?.present) return;

    // Closed copy of the orders LIST column ids (`ORDER_LIST_COLUMN_IDS`).
    // Frozen here on purpose: a migration must keep meaning what it meant when
    // it ran, whatever the column registry later grows.
    const narrowed = `
      SELECT p."id", p."userId", p."name", p."createdAt", p."updatedAt",
             (SELECT jsonb_agg(c.col ORDER BY c.ord)
                FROM jsonb_array_elements_text(p."columns") WITH ORDINALITY AS c(col, ord)
               WHERE c.col IN ('customer', 'channel', 'status', 'shipment', 'money')) AS list_columns
        FROM "order_column_presets" p`;

    await queryRunner.query(`
      INSERT INTO "saved_views"
        ("scope", "owner_user_id", "created_by_user_id", "page_key", "name",
         "definition", "is_workspace_default", "created_at", "updated_at")
      SELECT 'personal', n."userId", n."userId", 'orders', left(btrim(n."name"), 100),
             jsonb_build_object('v', 1, 'query', '', 'sort', 'null'::jsonb,
                                'columns', n.list_columns, 'parts', '{}'::jsonb),
             false, n."createdAt", n."updatedAt"
        FROM (${narrowed}) n
        JOIN "users" u ON u."id" = n."userId"
       WHERE n."userId" IS NOT NULL
         AND n.list_columns IS NOT NULL
         AND length(btrim(n."name")) > 0
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "saved_views"
        ("scope", "owner_user_id", "created_by_user_id", "page_key", "name",
         "definition", "is_workspace_default", "created_at", "updated_at")
      SELECT 'shared', NULL, NULL, 'orders', left(btrim(n."name"), 100),
             jsonb_build_object('v', 1, 'query', '', 'sort', 'null'::jsonb,
                                'columns', n.list_columns, 'parts', '{}'::jsonb),
             true, n."createdAt", n."updatedAt"
        FROM (${narrowed}) n
       WHERE n."userId" IS NULL
         AND n.list_columns IS NOT NULL
         AND length(btrim(n."name")) > 0
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = (await queryRunner.query(
      `SELECT to_regclass('public.order_column_presets') IS NOT NULL AS present`
    )) as { present: boolean }[];
    if (!exists[0]?.present) return;
    await queryRunner.query(`
      DELETE FROM "saved_views" v
       USING "order_column_presets" p
       WHERE v."page_key" = 'orders'
         AND v."name" = left(btrim(p."name"), 100)
         AND v."owner_user_id" IS NOT DISTINCT FROM p."userId"
         AND v."definition"->'columns' = (
           SELECT jsonb_agg(c.col ORDER BY c.ord)
             FROM jsonb_array_elements_text(p."columns") WITH ORDINALITY AS c(col, ord)
            WHERE c.col IN ('customer', 'channel', 'status', 'shipment', 'money'))
    `);
  }
}
