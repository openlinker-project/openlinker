import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdapterKeyToConnections1766837314000
  implements MigrationInterface
{
  name = 'AddAdapterKeyToConnections1766837314000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "connections" 
      ADD COLUMN "adapterKey" character varying NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_connections_adapterKey" 
      ON "connections" ("adapterKey")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_connections_adapterKey"`);
    await queryRunner.query(`ALTER TABLE "connections" DROP COLUMN "adapterKey"`);
  }
}

