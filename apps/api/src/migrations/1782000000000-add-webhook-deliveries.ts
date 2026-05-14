import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookDeliveries1782000000000 implements MigrationInterface {
  name = 'AddWebhookDeliveries1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventId" text NOT NULL,
        "provider" text NOT NULL,
        "connectionId" uuid NOT NULL,
        "eventType" text,
        "objectType" text,
        "externalId" text,
        "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "signatureValid" boolean,
        "dedupResult" text,
        "status" text NOT NULL,
        "rejectionReason" text,
        "publishedMessageId" text,
        "downstreamJobId" text,
        "downstreamJobType" text,
        "dlqReason" text,
        "payload" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "uq_webhook_deliveries_event_key" UNIQUE ("provider", "connectionId", "eventId"),
        CONSTRAINT "PK_webhook_deliveries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_deliveries_receivedAt" ON "webhook_deliveries" ("receivedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_deliveries_connection_receivedAt" ON "webhook_deliveries" ("connectionId", "receivedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_deliveries_provider_receivedAt" ON "webhook_deliveries" ("provider", "receivedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_deliveries_status_receivedAt" ON "webhook_deliveries" ("status", "receivedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_webhook_deliveries_status_receivedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_webhook_deliveries_provider_receivedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_webhook_deliveries_connection_receivedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_webhook_deliveries_receivedAt"`);
    await queryRunner.query(`DROP TABLE "webhook_deliveries"`);
  }
}
