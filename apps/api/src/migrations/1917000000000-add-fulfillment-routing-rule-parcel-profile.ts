import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the optional parcel profile columns to fulfillment_routing_rules (#3651)
 *
 * Auto-dispatch bought every label with ONE parcel shape per executor
 * connection, which cannot serve a connection carrying both a locker method
 * (needs a size template) and a courier method (needs a fixed L/W/H box). The
 * routing rule already scopes "this delivery method ships with this carrier",
 * so the parcel shape lives there.
 *
 * All five columns are nullable with no default: a rule without a profile
 * (every existing row) keeps resolving exactly as before. Dimensions are
 * all-or-none, enforced by the service rather than a CHECK so the integration
 * harness (synchronize) and production agree.
 */
export class AddFulfillmentRoutingRuleParcelProfile1917000000000 implements MigrationInterface {
  name = 'AddFulfillmentRoutingRuleParcelProfile1917000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "fulfillment_routing_rules"
        ADD COLUMN "parcel_template" character varying(32),
        ADD COLUMN "parcel_length_mm" integer,
        ADD COLUMN "parcel_width_mm" integer,
        ADD COLUMN "parcel_height_mm" integer,
        ADD COLUMN "parcel_default_weight_grams" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "fulfillment_routing_rules"
        DROP COLUMN "parcel_default_weight_grams",
        DROP COLUMN "parcel_height_mm",
        DROP COLUMN "parcel_width_mm",
        DROP COLUMN "parcel_length_mm",
        DROP COLUMN "parcel_template"
    `);
  }
}
