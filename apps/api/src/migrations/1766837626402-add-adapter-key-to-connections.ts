import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdapterKeyToConnections766837626402 implements MigrationInterface {
    name = 'AddAdapterKeyToConnections1766837626402'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "connections" ADD "adapterKey" character varying`);
        await queryRunner.query(`CREATE INDEX "IDX_bdaa7f89c1e87b9e707868988e" ON "connections" ("adapterKey") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_bdaa7f89c1e87b9e707868988e"`);
        await queryRunner.query(`ALTER TABLE "connections" DROP COLUMN "adapterKey"`);
    }

}
