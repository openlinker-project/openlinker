/**
 * Migration: Add connection_order_state_mappings table (#862)
 *
 * Per-connection override mapping a canonical OL OrderStatus to the
 * destination platform's native order-state id. Scoped by the DESTINATION
 * connection (the shop whose state catalogue is customised). The
 * `external_state_id` column is platform-neutral by design so a future
 * destination can reuse the table shape (PrestaShop stores its numeric
 * order-state id as a string). Unique on (connection_id, ol_status).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConnectionOrderStateMappings1799000000008 implements MigrationInterface {
  name = 'AddConnectionOrderStateMappings1799000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "connection_order_state_mappings" (
        "id"                 uuid               NOT NULL DEFAULT gen_random_uuid(),
        "connection_id"      uuid               NOT NULL,
        "ol_status"          character varying(50)  NOT NULL,
        "external_state_id"  character varying(50)  NOT NULL,
        "created_at"         timestamptz        NOT NULL DEFAULT now(),
        "updated_at"         timestamptz        NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connection_order_state_mappings_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_connection_order_state_mappings_conn_status"
          UNIQUE ("connection_id", "ol_status"),
        CONSTRAINT "FK_connection_order_state_mappings_connection"
          FOREIGN KEY ("connection_id") REFERENCES "connections" ("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "connection_order_state_mappings"`);
  }
}
