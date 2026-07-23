import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable per-connection signal for signature-rejected inbound webhook
 * deliveries (#1814). Kept separate from `webhook_deliveries`, which stays
 * reserved for successfully-verified deliveries (ADR-005). One rolling row per
 * `(provider, connectionId)`: the ingress path upserts it (increment count,
 * refresh last-seen) on each auth rejection, and the webhook-status projection
 * reads it to expose the `auth-failing` activation state.
 */
export class AddWebhookAuthRejections1829000000000 implements MigrationInterface {
  name = 'AddWebhookAuthRejections1829000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "webhook_auth_rejections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" text NOT NULL,
        "connectionId" uuid NOT NULL,
        "rejectionCount" bigint NOT NULL,
        "firstRejectedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "lastRejectedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "lastReason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "uq_webhook_auth_rejections_key" UNIQUE ("provider", "connectionId"),
        CONSTRAINT "PK_webhook_auth_rejections" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_auth_rejections_connectionId" ON "webhook_auth_rejections" ("connectionId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_webhook_auth_rejections_connectionId"`);
    await queryRunner.query(`DROP TABLE "webhook_auth_rejections"`);
  }
}
