/**
 * Reset the FX reporting stamp on PrestaShop orders that were mislabelled EUR (#2277)
 *
 * Until #2277 the PrestaShop order mapper emitted a literal `currency: 'EUR'`
 * on every ingested order. Most downstream surfaces self-heal on the next
 * successful re-poll, because the order write is a full overwrite — the
 * snapshot, the `currency` column and `order_line_items` all get replaced.
 *
 * The ADR-040 reporting stamp does not. `OrderFxStampService` reads the
 * NATIVE currency off the snapshot and multiplies the order total by that
 * currency's rate, then writes the result under a write-once guard
 * (`reportingCurrency IS NULL`). Nothing in the codebase ever clears a stamp,
 * and `reportingCurrency IS NULL` sits in BOTH arms of the sweep predicate
 * (`findUnstampedFxOrderIds`), so a 249 PLN order stamped at the EUR rate stays
 * wrong forever. This migration nulls the stamp on exactly those rows so the
 * sweep re-stamps them from the corrected snapshot.
 *
 * ORDER OF DEPLOYMENT IS SAFE BY PREDICATE, NOT BY OPERATOR DISCIPLINE. The
 * scope is PrestaShop-sourced rows whose snapshot currency is ALREADY no longer
 * `'EUR'` — i.e. rows the corrected code has re-polled. Run before that re-poll
 * the statement matches nothing and is a verified no-op; it can never null a
 * stamp that would only be recomputed from the same wrong snapshot and
 * re-closed. It also leaves a genuinely-EUR PrestaShop order alone, since its
 * stamp was right all along.
 *
 * Six columns move together, back to the "never attempted" state of the ADR-040
 * table:
 *   - `reportingCurrency`     — the sweep predicate and all three write guards
 *   - `reportingTotalAmount`  — required with the above by `ck_order_records_fx_group`
 *   - `exchangeRateId`        — same CHECK arm; legitimately NULL on the
 *                               same-currency path, so it must be cleared too
 *   - `fxStampedAt`           — otherwise the row waits out the 7-day
 *                               terminal-retry cooldown before re-admission
 *   - `fxIntendedCurrency` + `fxRule` — the intent snapshot
 *     `claimFxIntentIfAbsent` writes as a pair. Clearing it re-resolves the
 *     reporting currency from the current setting, which is a deliberate
 *     restatement of those rows (ADR-040 records that a deployment which
 *     changed its reporting currency carries two eras).
 *
 * `enabledCapabilities` is deliberately NOT part of the predicate: capabilities
 * are stamped at connection create and never retro-filled, whereas
 * `order_records.sourceConnectionId` IS the evidence that the connection acted
 * as this order's source. Gating on the capability would silently skip rows.
 *
 * Note for the operator: `marketplace.order.fxStamp`'s sweep defaults to a
 * 30-day `createdSince` window, so orders older than that need either a
 * `maxAgeDays` bump on the scheduler descriptor or direct enqueues.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ResetFxStampForMislabelledPrestashopOrders1840000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The `jsonb_typeof(...) = 'string'` guard mirrors the repository's own
    // snapshot-currency reads: a malformed snapshot value must read as absent
    // rather than fail the statement (and it is what lets the expression index
    // `IDX_order_records_snapshot_currency` be used at all).
    await queryRunner.query(`
      UPDATE "order_records" o
      SET "reportingCurrency" = NULL,
          "reportingTotalAmount" = NULL,
          "exchangeRateId" = NULL,
          "fxStampedAt" = NULL,
          "fxIntendedCurrency" = NULL,
          "fxRule" = NULL
      FROM "connections" c
      WHERE c."id" = o."sourceConnectionId"
        AND c."platformType" = 'prestashop'
        AND o."reportingCurrency" IS NOT NULL
        AND jsonb_typeof(o."orderSnapshot"#>'{totals,currency}') = 'string'
        AND o."orderSnapshot"#>>'{totals,currency}' <> 'EUR'
    `);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op. `up()` discards a figure that was wrong; the
    // pre-migration values are not recoverable from anything still on the row,
    // and restoring them would mean re-asserting a reported total the operator
    // was told to stop trusting. The forward fix is the FX sweep re-stamping
    // from the corrected snapshot.
  }
}
