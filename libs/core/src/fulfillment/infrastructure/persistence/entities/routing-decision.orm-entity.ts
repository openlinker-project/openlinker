/**
 * Routing Decision ORM Entity (#2394, ADR-054 R1, DESIGN §5.3)
 *
 * The `routing_decisions` table — OpenLinker's record that it is about to ask a
 * router where an order is fulfilled from, persisted BEFORE the committing
 * `route()` call.
 *
 * **Every index is declared class-level with the SAME NAME the migration uses.**
 * The integration harness builds its schema by `synchronize`, so an unnamed
 * decorator would produce a hash name there and the two schemas would diverge
 * on exactly the constraints `fulfillment-work-migration-parity.int-spec.ts`
 * asserts.
 *
 * ## The live partial-unique index, and why the predicate is EXACTLY that wide
 *
 * `UNIQUE ("orderId") WHERE "state" = 'live'`.
 *
 * - **Not unconditional on `("orderId")`** — that forbids any second decision
 *   for an order, ever, breaking the legitimate re-route DESIGN §5.4 requires
 *   (`short_picked` + `releaseShortfall` re-enters `route()` with the rejecter
 *   blocked).
 * - **Not `("orderId", "routerConnectionId")`** — that permits two routers to
 *   hold two live decisions for one order, which is precisely the double-ship
 *   #2395's guard must refuse "regardless of router identity". A double-ship is
 *   a physical, unrecoverable event.
 * - **Predicate is `state = 'live'` only** — a terminal row must LEAVE the index
 *   so a fresh decision can claim.
 *
 * ## On the mutable-predicate warning next door
 *
 * `shipment.orm-entity.ts` argues against putting a mutable column in a partial
 * index predicate (rows enter and leave the index on ordinary updates) and keys
 * on the monotone `providerShipmentId IS NULL` marker instead. **That warning
 * does not govern here**: rows leaving the index on terminalisation is the
 * MECHANISM, not a side effect. The governing precedents are
 * `UQ_order_changes_open_target` (`WHERE "status" IN ('pending','requested')`)
 * and `UQ_reservations_active_line` (`WHERE "status" = 'held'`), both of which
 * key uniqueness on an open-state predicate exactly as this does. Do not
 * "correct" this toward the shipments shape.
 *
 * ## Necessary, not sufficient
 *
 * The index enforces at most one live DECISION per order. DESIGN §5.3 also
 * requires refusing when non-cancelled WORK exists — a different set, since a
 * `committed` decision with live work leaves the index free. That half is
 * #2395's; nothing here refuses it.
 *
 * ## No foreign keys
 *
 * `orderId` and `routerConnectionId` are cross-aggregate references by value —
 * the `order_changes` / `refund_records` / `fulfillment_works.orderId`
 * precedent. An INTENT record must survive the thing it decided about: a
 * deleted connection must not erase the audit of what it decided, and a
 * re-ingested order must not cascade away the decision history.
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { RoutingDecisionState } from '../../../domain/types/routing-decision.types';
import type { RoutingDecisionAbandonReason } from '../../../domain/types/routing-decision.types';

@Entity('routing_decisions')
// THE guard. See the class docblock for why the predicate is exactly this wide.
@Index('UQ_routing_decisions_live_order', ['orderId'], {
  unique: true,
  where: `"state" = 'live'`,
})
// UNCONDITIONAL, and not redundant with the partial index above: the history
// read ("every decision for this order, whatever its state") cannot use a
// partial index restricted to live rows. `createdAt` rides along because that
// read is ordered — the `IDX_order_changes_order` shape.
@Index('IDX_routing_decisions_order', ['orderId', 'createdAt'])
export class RoutingDecisionOrmEntity {
  /**
   * `ol_routingdecision_*`, minted by the repository's own
   * `formatRoutingDecisionId` — NOT by `formatInternalId`, which this leaf
   * cannot value-import from a sibling context. See that function for the
   * trade-off and for the spec that pins the two formats together.
   *
   * The PK constraint is NAMED to match the migration's
   * `PK_routing_decisions`; without `primaryKeyConstraintName`, `synchronize`
   * mints a hash name and the two schemas differ on a constraint name — which
   * is precisely the drift the migration-parity int-spec exists to catch.
   */
  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'PK_routing_decisions' })
  id!: string;

  /** By-value reference to the order. No FK — see the class docblock. */
  @Column({ type: 'text' })
  orderId!: string;

  /** By-value reference to `connections.id`. No FK — see the class docblock. */
  @Column({ type: 'uuid' })
  routerConnectionId!: string;

  /**
   * Written ONLY by `terminalise`. Never accepted at create — `claimIntent`
   * builds the row `live` implicitly, so there is no way to insert a row that
   * is already terminal.
   */
  @Column({ type: 'varchar', length: 32, default: 'live' })
  state!: RoutingDecisionState;

  /** The ROUTER's own `RoutingPlan.decisionId`. Written only by `terminalise`. */
  @Column({ type: 'text', nullable: true })
  routerDecisionRef!: string | null;

  /**
   * Written only by `terminalise`. `varchar` rather than a PG enum (the house
   * convention — zero `CREATE TYPE … AS ENUM` in the tree), so #2395 widening
   * the union needs no `ALTER TYPE` and no coordinated deploy. Read back
   * through `readRoutingDecisionAbandonReason`, which coerces an unrecognised
   * value to `null`.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  abandonReason!: RoutingDecisionAbandonReason | null;

  /** Written only by `terminalise`. */
  @Column({ type: 'timestamptz', nullable: true })
  terminalisedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
