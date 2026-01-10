/**
 * Add Integration Credentials Table Migration
 *
 * Creates the integration_credentials table for storing OAuth credentials and other
 * integration secrets. Supports both encrypted and unencrypted storage (encrypted flag
 * for future encryption support).
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIntegrationCredentialsTable1768000000000 implements MigrationInterface {
  name = 'AddIntegrationCredentialsTable1768000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integration_credentials" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ref" character varying NOT NULL,
        "platformType" character varying NOT NULL,
        "credentialsJson" jsonb NOT NULL,
        "encrypted" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_credentials" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_integration_credentials_ref" ON "integration_credentials" ("ref")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_integration_credentials_platform" ON "integration_credentials" ("platformType")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_integration_credentials_platform"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_integration_credentials_ref"`);
    await queryRunner.query(`DROP TABLE "integration_credentials"`);
  }
}

