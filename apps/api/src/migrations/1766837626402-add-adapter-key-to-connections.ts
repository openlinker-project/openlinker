import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdapterKeyToConnections1766837626402 implements MigrationInterface {
  name = 'AddAdapterKeyToConnections1766837626402';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if column already exists (might have been added by an earlier migration)
    const table = await queryRunner.getTable('connections');
    const adapterKeyColumn = table?.findColumnByName('adapterKey');

    if (!adapterKeyColumn) {
      await queryRunner.query(`ALTER TABLE "connections" ADD "adapterKey" character varying`);
    }

    // Check if index already exists
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- migration QueryRunner returns untyped rows
    const indexExists = await queryRunner.query(`
            SELECT 1 FROM pg_indexes 
            WHERE tablename = 'connections' 
            AND indexname = 'IDX_bdaa7f89c1e87b9e707868988e'
        `);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- migration QueryRunner returns untyped rows
    if (indexExists.length === 0) {
      await queryRunner.query(
        `CREATE INDEX "IDX_bdaa7f89c1e87b9e707868988e" ON "connections" ("adapterKey") `
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_bdaa7f89c1e87b9e707868988e"`);
    await queryRunner.query(`ALTER TABLE "connections" DROP COLUMN "adapterKey"`);
  }
}
