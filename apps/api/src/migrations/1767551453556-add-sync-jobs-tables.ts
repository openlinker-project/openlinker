import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncJobsTables1767551453556 implements MigrationInterface {
  name = 'AddSyncJobsTables1767551453556';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "sku" character varying, "price" numeric(10,2), "description" text, "images" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "product_variants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productId" uuid NOT NULL, "sku" character varying, "attributes" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_281e3f2c55652d6a22c0aa59fd7" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productId" uuid NOT NULL, "productVariantId" uuid, "availableQuantity" integer NOT NULL, "reservedQuantity" integer NOT NULL DEFAULT '0', "locationId" character varying, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cf2f451407242e132547ac19169" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c8aa42e2481ff1992bca22a9bc" ON "inventory_items" ("productId", "productVariantId", "locationId") WHERE "productVariantId" IS NOT NULL`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b907bd3ca244348f00e235a3f8" ON "inventory_items" ("productId", "locationId") WHERE "productVariantId" IS NULL`
    );
    await queryRunner.query(
      `CREATE TABLE "sync_jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "jobType" character varying NOT NULL, "connectionId" uuid NOT NULL, "payloadJson" jsonb NOT NULL, "status" character varying NOT NULL, "idempotencyKey" character varying NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "maxAttempts" integer NOT NULL DEFAULT '10', "nextRunAt" TIMESTAMP NOT NULL DEFAULT now(), "lockedAt" TIMESTAMP, "lockedBy" character varying, "lastError" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9da61f0b254051a6249d0ae2ea1" UNIQUE ("idempotencyKey"), CONSTRAINT "PK_8586b15058c8811de6286052139" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3086c88607c1c8b303fe1172f2" ON "sync_jobs" ("lockedAt") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a2d0990898df9d69d7c3b53ca9" ON "sync_jobs" ("status", "nextRunAt") `
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD CONSTRAINT "FK_f515690c571a03400a9876600b5" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_4a1e232a660d7d51a13f20099b2" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_8fa4cdd8e98fde93d4f14025417" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_items" DROP CONSTRAINT "FK_8fa4cdd8e98fde93d4f14025417"`
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" DROP CONSTRAINT "FK_4a1e232a660d7d51a13f20099b2"`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT "FK_f515690c571a03400a9876600b5"`
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_a2d0990898df9d69d7c3b53ca9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3086c88607c1c8b303fe1172f2"`);
    await queryRunner.query(`DROP TABLE "sync_jobs"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b907bd3ca244348f00e235a3f8"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c8aa42e2481ff1992bca22a9bc"`);
    await queryRunner.query(`DROP TABLE "inventory_items"`);
    await queryRunner.query(`DROP TABLE "product_variants"`);
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
