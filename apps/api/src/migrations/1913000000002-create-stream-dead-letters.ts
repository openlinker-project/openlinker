/**
 * Create `stream_dead_letters` (#2301, D48)
 *
 * The durable record a Redis Streams consumer writes when one entry has
 * failed recovery `MAX_RECOVERY_ATTEMPTS` times. Closes the "Known gap — no
 * terminal state for a poison entry" ADR-049 named: before this, an entry
 * whose handler always throws was retried indefinitely, with only a
 * one-time in-memory log line as any record of it.
 *
 * Three schema decisions carry the design.
 *
 * - **`raw_fields` is `jsonb`, exactly the k/v pairs `XRANGE`/`XPENDING`
 *   hand back — never a typed payload.** A typed payload is precisely what
 *   could not be built from a raw pending entry (job-intake needs a parsed
 *   job request, the master-deletion handler a decoded domain event), which
 *   is the reason auto-dead-lettering was rejected when this table did not
 *   exist. Storing the raw fields removes that objection.
 * - **`UQ_stream_dead_letters_stream_group_entry` is the upsert's conflict
 *   target, not merely a duplicate guard.** The write and the `XACK` that
 *   follows it are two separate operations; a crash between them leaves the
 *   entry pending, Redis redelivers it, and the SAME
 *   `(stream, consumer_group, entry_id)` is written again. The repository's
 *   `INSERT ... ON CONFLICT ... DO UPDATE` targets this index and
 *   deliberately never touches `first_seen_at` in its `SET` clause, so a
 *   re-write updates `attempts`/`last_error`/`last_seen_at` while the first
 *   sighting stays fixed.
 * - **No foreign key to anything.** A dead letter is evidence about a
 *   Redis stream entry that may reference a `sync_jobs` row, a connection, or
 *   nothing at all (the raw fields are opaque at this layer) — it must
 *   outlive whatever it references, the `reservation_shortfall_episodes` /
 *   `order_changes` precedent for an evidentiary row.
 *
 * `consumer_group` (never `group`, a reserved SQL keyword needing to be
 * quoted everywhere) and `entry_id` together with `stream` identify the
 * Redis Pending Entries List row this record came from.
 *
 * No retention sweep ships with the table, and that is deliberate.
 * `IDX_stream_dead_letters_last_seen_at` serves the Diagnostics ordering and
 * would also serve a future age-bound sweep. Rows are bounded in practice by
 * the 10-attempt retry ceiling. The deferral and the condition that would end
 * it are recorded on `StreamDeadLetterRepositoryPort`.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStreamDeadLetters1913000000002 implements MigrationInterface {
  name = 'CreateStreamDeadLetters1913000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stream_dead_letters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "stream" text NOT NULL,
        "consumer_group" text NOT NULL,
        "entry_id" text NOT NULL,
        "raw_fields" jsonb NOT NULL,
        "attempts" integer NOT NULL,
        "last_error" text NOT NULL,
        "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stream_dead_letters" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_stream_dead_letters_stream_group_entry"
        ON "stream_dead_letters" ("stream", "consumer_group", "entry_id")
    `);

    // The Diagnostics read's ordering (most-recently-seen-first).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stream_dead_letters_last_seen_at"
        ON "stream_dead_letters" ("last_seen_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_stream_dead_letters_last_seen_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_stream_dead_letters_stream_group_entry"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stream_dead_letters"`);
  }
}
