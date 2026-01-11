/**
 * Add Customer Projections Tables Migration
 *
 * Creates tables for customer projections (Model C) and destination address mappings.
 * These tables store lightweight projections for debugging, retry support, and future routing.
 *
 * Generated: 2026-01-27
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerProjectionsTables1769000000000 implements MigrationInterface {
  name = 'AddCustomerProjectionsTables1769000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if tables already exist (might have been created manually or by a later migration)
    const customerProjectionsTable = await queryRunner.getTable('customer_projections');
    const customerAddressProjectionsTable = await queryRunner.getTable('customer_address_projections');
    const destinationAddressMappingsTable = await queryRunner.getTable('destination_address_mappings');

    // Create customer_projections table
    if (!customerProjectionsTable) {
      await queryRunner.query(`
        CREATE TABLE "customer_projections" (
          "internalCustomerId" text NOT NULL,
          "emailHash" character varying(64) NOT NULL,
          "normalizedEmail" character varying,
          "firstName" character varying,
          "lastName" character varying,
          "lastSeenAt" TIMESTAMP NOT NULL,
          "lastSourceConnectionId" uuid,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_customer_projections" PRIMARY KEY ("internalCustomerId")
        )
      `);

      // Create index on emailHash for lookup
      await queryRunner.query(`
        CREATE INDEX "IDX_customer_projections_emailHash" ON "customer_projections" ("emailHash")
      `);
    }

    // Create customer_address_projections table
    if (!customerAddressProjectionsTable) {
      await queryRunner.query(`
        CREATE TABLE "customer_address_projections" (
          "internalCustomerId" text NOT NULL,
          "addressHash" character varying(64) NOT NULL,
          "addressType" character varying(20) NOT NULL,
          "address1" character varying,
          "address2" character varying,
          "city" character varying,
          "postcode" character varying,
          "countryIso2" character varying(2),
          "lastSeenAt" TIMESTAMP NOT NULL,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_customer_address_projections" PRIMARY KEY ("internalCustomerId", "addressHash", "addressType")
        )
      `);

      // Create index on internalCustomerId for lookup
      await queryRunner.query(`
        CREATE INDEX "IDX_customer_address_projections_internalCustomerId" ON "customer_address_projections" ("internalCustomerId")
      `);
    }

    // Create destination_address_mappings table
    if (!destinationAddressMappingsTable) {
      await queryRunner.query(`
        CREATE TABLE "destination_address_mappings" (
          "internalCustomerId" text NOT NULL,
          "destinationConnectionId" uuid NOT NULL,
          "addressHash" character varying(64) NOT NULL,
          "addressType" character varying(20) NOT NULL,
          "destinationAddressId" character varying NOT NULL,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_destination_address_mappings" PRIMARY KEY ("internalCustomerId", "destinationConnectionId", "addressHash", "addressType")
        )
      `);

      // Create indexes for destination_address_mappings
      await queryRunner.query(`
        CREATE INDEX "IDX_destination_address_mappings_customer_connection" ON "destination_address_mappings" ("internalCustomerId", "destinationConnectionId")
      `);

      await queryRunner.query(`
        CREATE INDEX "IDX_destination_address_mappings_connection_hash_type" ON "destination_address_mappings" ("destinationConnectionId", "addressHash", "addressType")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(
      `DROP INDEX "public"."IDX_destination_address_mappings_connection_hash_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_destination_address_mappings_customer_connection"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_customer_address_projections_internalCustomerId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_customer_projections_emailHash"`);

    // Drop tables
    await queryRunner.query(`DROP TABLE "destination_address_mappings"`);
    await queryRunner.query(`DROP TABLE "customer_address_projections"`);
    await queryRunner.query(`DROP TABLE "customer_projections"`);
  }
}
