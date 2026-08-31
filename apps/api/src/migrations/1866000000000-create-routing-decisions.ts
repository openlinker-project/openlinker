/**
 * Create the routing-decision intent table (#2394, `W3a-5`, ADR-054 R1, DESIGN §5.3).
 *
 * `routing_decisions` — OpenLinker's record that it is about to ask a router
 * where an order is fulfilled from, persisted BEFORE the committing `route()`
 * call. REVIEW C2: persisted evidence must land before the boundary it
 * protects, an ordering a lock alone cannot supply.
 *
 * Four choices below are **contract rather than housekeeping**:
 *
 * - **`UQ_routing_decisions_live_order` is keyed on `("orderId")` alone, with
 *   the predicate `"state" = 'live'`.** Keyed additionally on
 *   `routerConnectionId` it would permit two routers to hold two live decisions
 *   for one order — the double-ship #2395's guard must refuse "regardless of
 *   router identity". Made unconditional it would forbid the legitimate
 *   re-route DESIGN §5.4 requires. The mutable predicate is the MECHANISM (a
 *   terminal row must leave the index), which is why the
 *   `UQ_order_changes_open_target` / `UQ_reservations_active_line` precedents
 *   govern here rather than the `shipments` warning against mutable predicates.
 *
 * - **`IDX_routing_decisions_order` is unconditional and NOT redundant** with
 *   the partial index: the history read ("every decision for this order,
 *   whatever its state") cannot use an index restricted to live rows.
 *   `createdAt` rides along because that read is ordered — `IDX_order_changes_order`.
 *
 * - **No foreign keys at all.** `orderId` and `routerConnectionId` are
 *   cross-aggregate references by value (the `order_changes` / `refund_records`
 *   precedent). An INTENT record must survive the thing it decided about: a
 *   deleted connection must not erase the audit of what it decided.
 *
 * - **No `CREATE EXTENSION "uuid-ossp"`**, unlike its #2392 neighbour. That
 *   migration needs it because its line and hold primary keys default to
 *   `uuid_generate_v4()`; this table's primary key is `text` minted in
 *   application code and no column takes a uuid default, so copying the
 *   statement would propagate the #2684 workaround to a migration that does not
 *   need it.
 *
 * No PG enum on any vocabulary column, matching the whole tree (zero
 * `CREATE TYPE … AS ENUM` in `apps/api/src/migrations`): the unions are
 * enforced in TypeScript, so #2395 widening `abandonReason` needs no
 * `ALTER TYPE` plus a coordinated deploy.
 *
 * Generated: 2026-08-30 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1864000000000 is #2392's fulfillment-work tables). Renumbered from
 * 1865000000000 to 1866000000000: #2400 merged that prefix into
 * `oms-programme-wave-3a` while this branch was in review, and TypeORM sorts
 * by timestamp alone with no deterministic tie-breaker, so a collision can
 * leave one `up()` body silently unapplied (#374).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRoutingDecisions1866000000000 implements MigrationInterface {
  name = 'CreateRoutingDecisions1866000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "routing_decisions" (
        "id" text NOT NULL,
        "orderId" text NOT NULL,
        "routerConnectionId" uuid NOT NULL,
        "state" character varying(32) NOT NULL DEFAULT 'live',
        "routerDecisionRef" text,
        "abandonReason" character varying(64),
        "terminalisedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_routing_decisions" PRIMARY KEY ("id")
      )
    `);

    // At most one LIVE decision per order, across every router. See the header.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_routing_decisions_live_order"
        ON "routing_decisions" ("orderId")
        WHERE "state" = 'live'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_routing_decisions_order"
        ON "routing_decisions" ("orderId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_routing_decisions_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_routing_decisions_live_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "routing_decisions"`);
  }
}
