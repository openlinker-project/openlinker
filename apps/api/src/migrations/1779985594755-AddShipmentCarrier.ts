import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddShipmentCarrier1779985594755 implements MigrationInterface {
    name = 'AddShipmentCarrier1779985594755'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shipments" ADD "carrier" text`);
        await queryRunner.query(`CREATE INDEX "IDX_shipments_carrier" ON "shipments" ("carrier") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_shipments_carrier"`);
        await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN "carrier"`);
    }

}
