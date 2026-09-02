/**
 * Create `oms_routing_rules` (#2408)
 *
 * Hand-written deliberately: `apps/api/src/database/data-source.ts` scopes
 * entity discovery to `libs/core/src/**` , so the TypeORM CLI cannot see a
 * `libs/oms` entity and `migration:generate` would emit nothing.
 *
 * The partial unique index is the duplicate detection ADR-054's storage
 * amendment asks for. It replaces that precedent's `conditionsHash`: the
 * routing vocabulary is CLOSED, so `(kind, name)` already IS a rule's identity
 * and there is no unbounded condition blob to hash.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOmsRoutingRules1869000000200 implements MigrationInterface {
  name = 'CreateOmsRoutingRules1869000000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "oms_routing_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "connectionId" text NOT NULL,
        "position" integer NOT NULL,
        "kind" character varying(16) NOT NULL,
        "name" character varying(64) NOT NULL,
        "afterAction" character varying(32) NOT NULL,
        "priorityLocationIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "effectiveFrom" TIMESTAMP WITH TIME ZONE,
        "effectiveTo" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oms_routing_rules" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_oms_routing_rules_connection_position"
        ON "oms_routing_rules" ("connectionId", "position")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_oms_routing_rules_live_name"
        ON "oms_routing_rules" ("connectionId", "kind", "name")
        WHERE "effectiveTo" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_oms_routing_rules_live_name"`);
    await queryRunner.query(`DROP INDEX "IDX_oms_routing_rules_connection_position"`);
    await queryRunner.query(`DROP TABLE "oms_routing_rules"`);
  }
}
