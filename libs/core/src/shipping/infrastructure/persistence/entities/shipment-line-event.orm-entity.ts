/**
 * Shipment Line Event ORM Entity (#2727)
 *
 * The append-only act ledger beside `shipment_lines`' counters — and the reason
 * the #2727 backfill can be event-shaped rather than a snapshot.
 *
 * ## Why the ledger exists at all
 *
 * Order O, line L, quantity 2. `S1` dispatched then cancelled; `S2` the
 * re-issue, dispatched.
 *
 * - A SNAPSHOT backfill writes `S1.shipped = 2` and `S2.shipped = 2`, so the
 *   order-level shipped quantity is 4 — permanently, and unfixably, because
 *   both rows claim to be shipments of the same units and nothing distinguishes
 *   a correction from a second shipment.
 * - An EVENT backfill writes `S1: ship(2), cancel(2)` (net 0) and
 *   `S2: ship(2)` (net 2). Order-level net is 2.
 *
 * The `cancel` act IS the thing that distinguishes a correction from a second
 * shipment. It exists only because the backfill walks each shipment's history
 * instead of restating its end state.
 *
 * ## The uniqueness key is `(shipmentLineId, kind, occurredAt)`
 *
 * It is tempting to key on `(line, kind)` alone, on the reasoning that a
 * shipment ships once. That reasoning is FALSE: `ShipmentDispatchService`
 * persists `failed` in its `generateLabel` catch and a retry re-enters on the
 * same `shipment.id`, so `failed -> generated -> dispatched` is reachable on
 * one row. Under a `(line, kind)` key, a line that had emitted `ship` +
 * `cancel` could never record its successful re-dispatch — folding to a net
 * shipped of 0 for a parcel that really shipped, permanently.
 *
 * Putting the instant in the key fixes that without the returns
 * `(returnLineId, seq)` shape, which would need a sequence counter and
 * therefore a lock to allocate it:
 *
 * - a repeated reconcile over an unchanged shipment re-derives the identical
 *   tuple and inserts nothing — idempotent under a bare `ON CONFLICT DO NOTHING`;
 * - a genuine re-dispatch carries a NEW `dispatchedAt` and correctly emits a
 *   second `ship` act.
 *
 * ## FK, and what is deliberately absent
 *
 * `shipmentLineId` carries `shipment_lines(id) ON DELETE CASCADE`, declared in
 * the **migration only** with no `@ManyToOne` — an act is a part of its line
 * (the `fulfillment_work_lines` / `return_lines` criterion), and the leading
 * column of the unique index serves the referential check.
 *
 * There is deliberately **no denormalised `shipmentId`**, unlike
 * `return_line_events.returnId`. That column exists there to serve a specific
 * per-return read; nothing here asks a per-shipment question that does not go
 * through the line, so a copy would be a second fact able to disagree with the
 * first for no benefit.
 *
 * Every index and check is declared here under the SAME NAME the migration
 * uses — the harness builds by `synchronize`, and both tables join
 * `fulfillment-work-migration-parity.int-spec.ts`.
 *
 * @module libs/core/src/shipping/infrastructure/persistence/entities
 */
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ShipmentLineActKind } from '../../../domain/types/shipment-line.types';

@Entity('shipment_line_events')
// See the class docblock for why `occurredAt` is a KEY column and not merely
// payload. Its leading column serves every `WHERE "shipmentLineId" = ?` fold
// AND the CASCADE FK's referential check, so no separate index on that column.
@Index('UQ_shipment_line_events_line_kind_occurred', ['shipmentLineId', 'kind', 'occurredAt'], {
  unique: true,
})
// An act is about a positive whole number of units. Zero or negative would make
// the counters folded from these rows meaningless, and a reversal is modelled
// as its own `cancel` act rather than as a negative `ship`.
// Copied verbatim in shape from `CHK_return_line_events_quantity_positive`.
@Check('CHK_shipment_line_events_quantity_positive', '"quantity" > 0')
export class ShipmentLineEventOrmEntity {
  /** Named for the same reason `ShipmentLineOrmEntity.id` is — see there. */
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_shipment_line_events' })
  id!: string;

  /**
   * FK to `shipment_lines.id`, which is a generated **uuid** — so this column is
   * `uuid` and not `text`.
   *
   * The two must match: Postgres refuses `FK_shipment_line_events_line` outright
   * ("foreign key constraint cannot be implemented") when the referencing and
   * referenced types differ. Its sibling `shipment_lines.shipmentId` IS `text`,
   * because `shipments.id` is an `ol_shipment_*` internal id rather than a uuid —
   * the two columns look alike and are deliberately different.
   *
   * Found by `fulfillment-work-migration-parity.int-spec.ts`, which is the only
   * automated check of a migration in this repository and the only thing that
   * builds these FKs at all (`synchronize` builds none, since neither entity
   * declares a `@ManyToOne`).
   */
  @Column({ type: 'uuid' })
  shipmentLineId!: string;

  /** `ship | deliver | cancel`, stored as text per house rule (no PG enum). */
  @Column({ type: 'varchar', length: 16 })
  kind!: ShipmentLineActKind;

  @Column({ type: 'integer' })
  quantity!: number;

  /**
   * The SHIPMENT's own instant — `dispatchedAt`, `deliveredAt`, or
   * `cancelledAt`/`failedAt`. Never `new Date()`: a carrier's act happened in
   * another system and OL's clock is not a witness to it (#2336 / #2367 /
   * #2371).
   *
   * Falls back to the shipment's immutable `createdAt` when it carries no
   * timestamp for the transition — **never `updatedAt`**, which moves on every
   * write and, being a KEY column here, would mint a fresh duplicate act on
   * every reconcile.
   */
  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
