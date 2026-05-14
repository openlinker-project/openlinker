import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTable1766246163229 implements MigrationInterface {
  name = 'AddUserTable1766246163229';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "identifier_mappings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "entityType" character varying NOT NULL, "internalId" character varying NOT NULL, "externalId" character varying NOT NULL, "platformType" character varying NOT NULL, "connectionId" uuid NOT NULL, "context" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e80386ce7bc918d60313d294c67" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_84b761294149aed081cfba5c95" ON "identifier_mappings" ("entityType", "internalId") `
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_accfd7583e8b809fb5a83739a5" ON "identifier_mappings" ("entityType", "platformType", "connectionId", "externalId") `
    );
    await queryRunner.query(
      `CREATE TABLE "connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "platformType" character varying NOT NULL, "name" character varying NOT NULL, "status" character varying NOT NULL, "config" jsonb NOT NULL, "credentialsRef" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0a1f844af3122354cbd487a8d03" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a439d6dd6c0eceb3ccadab1d3" ON "connections" ("status") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fe6212da29a184c0c47f294eda" ON "connections" ("platformType") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_fe6212da29a184c0c47f294eda"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6a439d6dd6c0eceb3ccadab1d3"`);
    await queryRunner.query(`DROP TABLE "connections"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_accfd7583e8b809fb5a83739a5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_84b761294149aed081cfba5c95"`);
    await queryRunner.query(`DROP TABLE "identifier_mappings"`);
  }
}
