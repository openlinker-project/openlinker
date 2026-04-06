import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncJobsConnectionIdCreatedAtIndex1777000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_sync_jobs_connectionId_createdAt" ON "sync_jobs" ("connectionId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_sync_jobs_connectionId_createdAt"`,
    );
  }
}
