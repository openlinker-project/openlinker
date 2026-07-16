/**
 * Numbering Per-Document-Type Routing Migration (#9 / #10 / #7)
 *
 * Evolves the invoice-numbering schema shipped in
 * `1820000000000-add-invoice-numbering-series` from the main/correction
 * assignment split to a document-type + register routing model:
 *
 *  - `invoice_numbering_series` gains a neutral `documentType` (#9) and an
 *    optional `register` scope (#10).
 *  - `invoice_numbering_routes` replaces `invoice_numbering_assignments`: a
 *    connection's document routes to a series by
 *    `(connectionId, documentType, register)`. Two partial unique indexes give
 *    NULL-distinct uniqueness on the routing key. The series FK stays
 *    `ON DELETE RESTRICT`; there is deliberately NO FK to `connections` (a route
 *    and its series survive connection deletion).
 *
 * A clean FOLLOW-ON (not an amend of 1820) because 1820 may already be applied
 * in dev / E2E environments; this migration carries the data forward: each
 * assignment becomes an `invoice` route (from `mainSeriesId`) and a `corrected`
 * route (from `correctionSeriesId`, falling back to `mainSeriesId`, preserving
 * the pre-#9 "correction falls back to the main series" behaviour), and each
 * correction-referenced series is stamped `documentType = 'corrected'`.
 * Idempotent (`IF [NOT] EXISTS`, `to_regclass` guards); `up()` + `down()`.
 * Country-agnostic (ADR-026): document types and register are neutral labels.
 *
 * Generated: 2026-07-16 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NumberingPerDocumentTypeRouting1821000000000 implements MigrationInterface {
  name = 'NumberingPerDocumentTypeRouting1821000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // 1. Series gains documentType (#9) + register (#10). DEFAULT 'invoice' so
    //    every pre-existing series backfills to the neutral base type.
    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_series" ADD COLUMN IF NOT EXISTS "documentType" text NOT NULL DEFAULT 'invoice'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_series" ADD COLUMN IF NOT EXISTS "register" text`,
    );

    // 2. Routing table replacing the main/correction assignment.
    const routesTable = await queryRunner.getTable('invoice_numbering_routes');
    if (!routesTable) {
      await queryRunner.query(`
        CREATE TABLE "invoice_numbering_routes" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "connectionId" uuid NOT NULL,
          "documentType" text NOT NULL,
          "register" text,
          "seriesId" uuid NOT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_invoice_numbering_routes" PRIMARY KEY ("id"),
          CONSTRAINT "FK_invoice_numbering_routes_series"
            FOREIGN KEY ("seriesId") REFERENCES "invoice_numbering_series" ("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        )
      `);
    }
    // NULL-distinct uniqueness on the routing key: one register-less default per
    // (connection, documentType), and one route per (connection, documentType,
    // register) when a register is present.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_numbering_routes_default"
        ON "invoice_numbering_routes" ("connectionId", "documentType")
        WHERE "register" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_numbering_routes_register"
        ON "invoice_numbering_routes" ("connectionId", "documentType", "register")
        WHERE "register" IS NOT NULL
    `);

    // 3. Carry the assignment data forward (only when the old table is present).
    const assignmentsExist = (await queryRunner.query(
      `SELECT to_regclass('public.invoice_numbering_assignments') AS reg`,
    )) as Array<{ reg: string | null }>;
    if (assignmentsExist[0]?.reg) {
      // main → 'invoice' route.
      await queryRunner.query(`
        INSERT INTO "invoice_numbering_routes"
          ("connectionId", "documentType", "register", "seriesId", "createdAt", "updatedAt")
        SELECT a."connectionId", 'invoice', NULL, a."mainSeriesId", a."createdAt", a."updatedAt"
        FROM "invoice_numbering_assignments" a
        ON CONFLICT DO NOTHING
      `);
      // correction (or main when none) → 'corrected' route.
      await queryRunner.query(`
        INSERT INTO "invoice_numbering_routes"
          ("connectionId", "documentType", "register", "seriesId", "createdAt", "updatedAt")
        SELECT a."connectionId", 'corrected', NULL,
               COALESCE(a."correctionSeriesId", a."mainSeriesId"), a."createdAt", a."updatedAt"
        FROM "invoice_numbering_assignments" a
        ON CONFLICT DO NOTHING
      `);
      // Stamp correction-referenced series with the 'corrected' document type.
      await queryRunner.query(`
        UPDATE "invoice_numbering_series" s
        SET "documentType" = 'corrected'
        FROM "invoice_numbering_assignments" a
        WHERE a."correctionSeriesId" = s."id"
      `);
      // 4. Drop the superseded assignment table.
      await queryRunner.query(`DROP TABLE IF EXISTS "invoice_numbering_assignments"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the assignment table (mirrors 1820's shape).
    const assignmentsTable = await queryRunner.getTable('invoice_numbering_assignments');
    if (!assignmentsTable) {
      await queryRunner.query(`
        CREATE TABLE "invoice_numbering_assignments" (
          "connectionId" uuid NOT NULL,
          "mainSeriesId" uuid NOT NULL,
          "correctionSeriesId" uuid,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_invoice_numbering_assignments" PRIMARY KEY ("connectionId"),
          CONSTRAINT "FK_invoice_numbering_assignments_main"
            FOREIGN KEY ("mainSeriesId") REFERENCES "invoice_numbering_series" ("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION,
          CONSTRAINT "FK_invoice_numbering_assignments_correction"
            FOREIGN KEY ("correctionSeriesId") REFERENCES "invoice_numbering_series" ("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        )
      `);
    }

    // Best-effort reconstruction: main = the 'invoice' default route, correction
    // = the 'corrected' default route (register-less) for the same connection.
    const routesExist = (await queryRunner.query(
      `SELECT to_regclass('public.invoice_numbering_routes') AS reg`,
    )) as Array<{ reg: string | null }>;
    if (routesExist[0]?.reg) {
      await queryRunner.query(`
        INSERT INTO "invoice_numbering_assignments"
          ("connectionId", "mainSeriesId", "correctionSeriesId", "createdAt", "updatedAt")
        SELECT m."connectionId", m."seriesId", c."seriesId", now(), now()
        FROM (
          SELECT "connectionId", "seriesId" FROM "invoice_numbering_routes"
          WHERE "documentType" = 'invoice' AND "register" IS NULL
        ) m
        LEFT JOIN (
          SELECT "connectionId", "seriesId" FROM "invoice_numbering_routes"
          WHERE "documentType" = 'corrected' AND "register" IS NULL
        ) c ON c."connectionId" = m."connectionId"
        ON CONFLICT DO NOTHING
      `);
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."UQ_invoice_numbering_routes_register"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."UQ_invoice_numbering_routes_default"`,
      );
      await queryRunner.query(`DROP TABLE IF EXISTS "invoice_numbering_routes"`);
    }

    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_series" DROP COLUMN IF EXISTS "register"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_series" DROP COLUMN IF EXISTS "documentType"`,
    );
  }
}
