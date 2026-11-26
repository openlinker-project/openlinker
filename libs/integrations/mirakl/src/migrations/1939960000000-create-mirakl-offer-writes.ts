/**
 * Create mirakl_offer_writes (#4277)
 *
 * Stock and price changes waiting to be sent to a Mirakl operator through
 * STO01 / PRI01, and the imports that carried them. See
 * `MiraklOfferWriteOrmEntity`.
 *
 * @module libs/integrations/mirakl/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMiraklOfferWrites1939960000000 implements MigrationInterface {
  name = 'CreateMiraklOfferWrites1939960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mirakl_offer_writes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connectionId" uuid NOT NULL,
        "kind" character varying NOT NULL,
        "offerSku" character varying NOT NULL,
        "value" character varying NOT NULL,
        "currency" character varying,
        "status" character varying NOT NULL,
        "importId" character varying,
        "version" integer NOT NULL DEFAULT 1,
        "error" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mirakl_offer_writes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_mirakl_offer_writes_pending"
      ON "mirakl_offer_writes" ("connectionId", "kind", "offerSku")
      WHERE "status" = 'pending'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_mirakl_offer_writes_connection_status"
      ON "mirakl_offer_writes" ("connectionId", "status", "kind")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_mirakl_offer_writes_import"
      ON "mirakl_offer_writes" ("connectionId", "importId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "mirakl_offer_writes"`);
  }
}
