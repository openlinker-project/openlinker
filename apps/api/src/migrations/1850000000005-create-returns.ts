/**
 * Create Returns Migration (#2327, ADR-060)
 *
 * Creates the `returns` + `return_lines` tables — the OL-owned return
 * aggregate above the source projection — and adds the nullable
 * `refund_records.returnId` link. Nothing else on `refund_records` is touched.
 *
 * **`returns` is a NON-RESERVED keyword in PostgreSQL** (it occurs in
 * `CREATE FUNCTION ... RETURNS`), so it is legal as a table name provided every
 * reference to it stays double-quoted — which every statement below does, and
 * which TypeORM's default naming strategy does for generated SQL. The name is
 * the one the issue's acceptance criteria state literally; `return_records` was
 * considered as the safer-reading alternative and not substituted, since the AC
 * names the table and the quoting requirement is mechanical.
 *
 * Two constraint choices are the model rather than housekeeping:
 *
 * - `CHK_return_lines_quantity_ordering` puts `advised >= received >=
 *   restocked + scrapped` (and non-negativity) in the DATABASE, so no caller —
 *   including one that bypasses the `returns` context entirely — can persist an
 *   impossible line. The same constraint is declared, under the SAME NAME, on
 *   `ReturnLineOrmEntity`, because the integration harness builds its schema by
 *   `synchronize` rather than by migration and an anonymous @Check would carry a
 *   hash name there.
 * - `UQ_returns_source_external` is PARTIAL on `"externalReturnId" IS NOT NULL`:
 *   it is #2328's idempotent update-or-create key
 *   (`docs/plans/analysis/DESIGN-oms-authority-model.md` § 7.3, :784-785), and a
 *   source that mints no return id at all (Erli) writes NULL, which must not
 *   collide with every other id-less return on the same connection.
 *
 * The ONE foreign key is `return_lines.returnId -> returns(id) ON DELETE
 * CASCADE`: a line is a part of its header, not a peer. There is deliberately
 * NO FK on `returns.sourceConnectionId`, `returns.internalOrderId` or
 * `return_lines.resolvedOrderLineId` — the first two follow the
 * `refund_records` / `invoice_records` precedent (indexed reference by value,
 * no cross-table lock coupling), and the third is not merely undesirable but
 * IMPOSSIBLE: `order_records` has no lines table, so the value points into the
 * `orderSnapshot` jsonb document.
 *
 * `shipments.direction` is NOT added here (return labels are Wave 2), so
 * ADR-060's note that `UQ_shipments_branch_one_per_order_conn` must gain
 * `direction` in its predicate is carried forward, not actioned.
 *
 * Generated: 2026-08-25 (synthetic sequential prefix per docs/migrations.md rule 3).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReturns1850000000005 implements MigrationInterface {
  name = 'CreateReturns1850000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `return_lines.id` defaults to uuid_generate_v4() — same guard the
    // refund_records migration uses (1833000000002:25).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "returns" (
        "id" text NOT NULL,
        "sourceConnectionId" uuid NOT NULL,
        "externalReturnId" text,
        "internalOrderId" text,
        "origin" varchar(32) NOT NULL,
        "rawStatus" text,
        "rawPayload" jsonb,
        "openedAt" TIMESTAMP WITH TIME ZONE,
        "authorizedAt" TIMESTAMP WITH TIME ZONE,
        "declinedAt" TIMESTAMP WITH TIME ZONE,
        "closedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_returns" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "return_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "returnId" text NOT NULL,
        "lineIndex" integer NOT NULL,
        "externalLineId" text,
        "resolvedOrderLineId" text,
        "offerId" text,
        "sku" text,
        "name" text,
        "reason" text NOT NULL,
        "quantityAdvised" integer NOT NULL,
        "quantityReceived" integer NOT NULL DEFAULT 0,
        "quantityRestocked" integer NOT NULL DEFAULT 0,
        "quantityScrapped" integer NOT NULL DEFAULT 0,
        "custodyState" varchar(32) NOT NULL DEFAULT 'advised',
        "moneyState" varchar(32) NOT NULL DEFAULT 'not_refundable',
        "disposition" varchar(32),
        "receivedAt" TIMESTAMP WITH TIME ZONE,
        "disposedAt" TIMESTAMP WITH TIME ZONE,
        "note" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_return_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_return_lines_return"
          FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_return_lines_quantity_ordering" CHECK (
          "quantityAdvised" >= 0
          AND "quantityReceived" >= 0
          AND "quantityRestocked" >= 0
          AND "quantityScrapped" >= 0
          AND "quantityAdvised" >= "quantityReceived"
          AND "quantityReceived" >= "quantityRestocked" + "quantityScrapped"
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_returns_source_external"
        ON "returns" ("sourceConnectionId", "externalReturnId")
        WHERE "externalReturnId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_returns_internal_order_id"
        ON "returns" ("internalOrderId")
    `);

    // The operator's orphan bucket, as an index rather than a scan — this is
    // `ReturnRepositoryPort.listOrphans`' exact query.
    await queryRunner.query(`
      CREATE INDEX "IDX_returns_orphans"
        ON "returns" ("createdAt" DESC)
        WHERE "internalOrderId" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_returns_connection_created"
        ON "returns" ("sourceConnectionId", "createdAt")
    `);

    // Line-level replay idempotency for #2328 (update line 0, never append a
    // second). Its LEADING column also serves every `WHERE "returnId" = ?`
    // lookup and the FK's referential check, so no separate `returnId` index is
    // created — a second one would be pure write amplification.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_return_lines_return_index"
        ON "return_lines" ("returnId", "lineIndex")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_return_lines_resolved_order_line"
        ON "return_lines" ("resolvedOrderLineId")
        WHERE "resolvedOrderLineId" IS NOT NULL
    `);

    // Linked, not extended — see the `RefundRecordOrmEntity.returnId` docblock.
    // Additive and nullable; no existing refund column is altered.
    await queryRunner.query(`
      ALTER TABLE "refund_records" ADD COLUMN IF NOT EXISTS "returnId" text
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_refund_records_return_id"
        ON "refund_records" ("returnId")
        WHERE "returnId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_refund_records_return_id"`);
    await queryRunner.query(`ALTER TABLE "refund_records" DROP COLUMN IF EXISTS "returnId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_return_lines_resolved_order_line"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_return_lines_return_index"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_returns_connection_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_returns_orphans"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_returns_internal_order_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_returns_source_external"`);
    // `return_lines` first — its FK references `returns`.
    await queryRunner.query(`DROP TABLE IF EXISTS "return_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "returns"`);
  }
}
