/**
 * Create channel_quantity_pushes (#4062)
 *
 * An append-only record of every quantity OpenLinker tried to write to a
 * channel listing: the quantity sent, whether the channel took it, and the
 * stock observation it expressed. The stock history reads it to show what was
 * sent for one movement, and the stock view reads the newest row per channel
 * as "last sent".
 *
 * `observedAt` equals the inventory row's `updatedAt`, which is also the stock
 * movement's `occurredAt`, so a movement finds its pushes by
 * (productVariantId, observedAt) with no id threaded between them. Pruned with
 * the movement ledger, on the same retention setting.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChannelQuantityPushes1938420000000 implements MigrationInterface {
  name = 'CreateChannelQuantityPushes1938420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel_quantity_pushes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connectionId" text NOT NULL,
        "externalOfferId" text NOT NULL,
        "productVariantId" text,
        "quantity" integer,
        "outcome" character varying(16) NOT NULL,
        "errorCode" character varying(48),
        "message" text,
        "observedAt" TIMESTAMP WITH TIME ZONE,
        "pushedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_channel_quantity_pushes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_channel_quantity_pushes_variant_observed" ON "channel_quantity_pushes" ("productVariantId", "observedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_channel_quantity_pushes_variant_conn_pushed" ON "channel_quantity_pushes" ("productVariantId", "connectionId", "pushedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_channel_quantity_pushes_pushed" ON "channel_quantity_pushes" ("pushedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "channel_quantity_pushes"`);
  }
}
