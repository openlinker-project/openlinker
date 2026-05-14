import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdapterKeyToConnections1766837314000 implements MigrationInterface {
  name = 'AddAdapterKeyToConnections1766837314000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if column already exists (might have been added by a later migration)
    const table = await queryRunner.getTable('connections');
    const adapterKeyColumn = table?.findColumnByName('adapterKey');

    if (!adapterKeyColumn) {
      await queryRunner.query(`
        ALTER TABLE "connections" 
        ADD COLUMN "adapterKey" character varying NULL
      `);
    }

    // Check if index already exists
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- migration QueryRunner returns untyped rows
    const indexExists = await queryRunner.query(`
      SELECT 1 FROM pg_indexes 
      WHERE tablename = 'connections' 
      AND indexname = 'IDX_connections_adapterKey'
    `);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- migration QueryRunner returns untyped rows
    if (indexExists.length === 0) {
      await queryRunner.query(`
        CREATE INDEX "IDX_connections_adapterKey" 
        ON "connections" ("adapterKey")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_connections_adapterKey"`);
    await queryRunner.query(`ALTER TABLE "connections" DROP COLUMN "adapterKey"`);
  }
}
