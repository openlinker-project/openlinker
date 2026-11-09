/**
 * Add webhook_deliveries.dlqCode (#3866)
 *
 * The code an operator reads for a dead-lettered delivery, beside the English
 * `dlqReason` kept for developers. Existing rows are backfilled from the
 * reason's prefix (`<code>: <detail>`), restricted to the five codes the
 * ingress router has ever written; any other reason keeps a NULL code and is
 * shown raw.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookDeliveryDlqCode1938760000000 implements MigrationInterface {
  name = 'AddWebhookDeliveryDlqCode1938760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "dlqCode" text`);
    await queryRunner.query(`
      UPDATE "webhook_deliveries"
         SET "dlqCode" = split_part("dlqReason", ':', 1)
       WHERE "dlqReason" IS NOT NULL
         AND "dlqCode" IS NULL
         AND split_part("dlqReason", ':', 1) IN
           ('connection-unavailable', 'no-translator', 'translator-threw', 'undecodable', 'ungated')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "webhook_deliveries" DROP COLUMN IF EXISTS "dlqCode"`);
  }
}
