/**
 * Add the OMS inert-state columns (#2352, Wave-2 product spec §4.2)
 *
 * One `jsonb` column per owning row — `order_records` and `returns` — holding an
 * array of `AuthorityAttentionEntry` keyed by the PRODUCER that reported it.
 *
 * ## Why an array rather than #2100's scalar reason column
 *
 * `order_records.salesDocumentBlockReason` is a scalar and is safe because ONE
 * authority re-decides the whole question on every order transition, so its
 * `null` is a complete statement. The producers here are three unrelated
 * subsystems (the reservation ledger, routing, the execution handshake) and an
 * order can genuinely carry two states at once — one line unroutable, another
 * short. A level-triggered scalar would make each producer's "nothing is wrong"
 * a claim about the others' questions too, so the operator-facing count would
 * depend on which subsystem ran last.
 *
 * ## No index, deliberately
 *
 * Nothing writes either column yet (the producers are the reservation-ledger and
 * returns-custody bodies and Wave 3), so an index added here would be permanently
 * empty DDL sized against no real cardinality. More importantly, the obvious
 * shape — a partial index over a hardcoded list of reason values — is exactly
 * what silently went stale on `IDX_order_records_salesDocumentBlockReason` when
 * #2248 widened that union and left the index's `WHERE … IN (…)` behind. The
 * producing issue adds the index against its own data and its own predicate.
 *
 * `ADD COLUMN IF NOT EXISTS` is the repo's re-runnability idiom, NOT a defence
 * against a sibling body claiming the same column name — that guard would
 * silently ADOPT a differently-typed column with a different writer. The defence
 * is the distinct `omsAttention` name, verified against `origin/main` before this
 * migration was generated.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOmsAttention1853000000000 implements MigrationInterface {
  name = 'AddOmsAttention1853000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "omsAttention" jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "omsAttention" jsonb`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "returns" DROP COLUMN IF EXISTS "omsAttention"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "omsAttention"`);
  }
}
