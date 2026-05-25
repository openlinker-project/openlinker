import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the `fulfillment_routing_rules` table (#832) — the general
 * fulfillment-routing model generalizing `connection_carrier_mappings`.
 *
 * Additive: `connection_carrier_mappings` is left untouched (it remains the
 * co-keyed branch-1 carrier source). One rule per
 * `(source_connection_id, source_delivery_method_id)`. Both connection
 * references FK to `connections` ON DELETE CASCADE — a deleted source removes
 * its rules; a deleted processor removes rules that route to it (reverting
 * that `(source, method)` to the omp_fulfilled default). See ADR-012.
 */
export class AddFulfillmentRoutingRules1799000000005 implements MigrationInterface {
  name = 'AddFulfillmentRoutingRules1799000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fulfillment_routing_rules" (
        "id"                         uuid                   NOT NULL DEFAULT gen_random_uuid(),
        "source_connection_id"       uuid                   NOT NULL,
        "source_delivery_method_id"  character varying(100) NOT NULL,
        "processor_kind"             character varying(32)  NOT NULL,
        "processor_connection_id"    uuid                   NOT NULL,
        "created_at"                 timestamptz            NOT NULL DEFAULT now(),
        "updated_at"                 timestamptz            NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fulfillment_routing_rules_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_fulfillment_routing_rules_source_method"
          UNIQUE ("source_connection_id", "source_delivery_method_id"),
        CONSTRAINT "FK_fulfillment_routing_rules_source_connection"
          FOREIGN KEY ("source_connection_id") REFERENCES "connections" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_fulfillment_routing_rules_processor_connection"
          FOREIGN KEY ("processor_connection_id") REFERENCES "connections" ("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "fulfillment_routing_rules"`);
  }
}
