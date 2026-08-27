/**
 * Bound the penalty-free deferral path (#2613/#2617 review, epic #2590).
 *
 * A deferral - a destination throttling us (429), a destination that is
 * unavailable (503), or a write refused because a peer held the lock - requeues
 * a job without consuming a retry attempt. That is the point: a maintenance
 * window must not dead-letter a day's work. But with no bound a destination
 * that answers 503 for ever recycles its jobs for ever: they sit at `queued`,
 * hold that connection's lane scope slots, and never reach `dead`.
 *
 * This column is that bound. It accumulates the deferral wait GRANTED to the
 * job, and once the runner's budget is spent the job rejoins the ordinary retry
 * ladder. A cumulative budget rather than a deferral count, because grants
 * differ by an order of magnitude and a count would mean a different amount of
 * patience per reason.
 *
 * Additive, nullable, no backfill. `NULL` means never deferred, which is true
 * of every existing row.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncJobDeferredTotal1842000000002 implements MigrationInterface {
  name = 'AddSyncJobDeferredTotal1842000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_jobs" ADD COLUMN IF NOT EXISTS "deferredTotalMs" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sync_jobs" DROP COLUMN IF EXISTS "deferredTotalMs"`);
  }
}
