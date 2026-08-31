/**
 * Fulfillment Work ORM Entity (#2392, ADR-054, DESIGN §5.2)
 *
 * The `fulfillment_works` table — an order's line-quantities grouped per
 * (location, delivery method), carrying two orthogonal state axes.
 *
 * **Every index is declared class-level with the SAME NAME the migration uses.**
 * The integration harness builds its schema by `synchronize`, not by migration,
 * so an unnamed decorator would produce a hash name there and the two schemas
 * would diverge on exactly the constraints an int-spec asserts.
 *
 * **Vocabulary columns are `varchar`, never a PG enum** — the house convention
 * (zero `CREATE TYPE … AS ENUM` in the tree): the union is enforced in
 * TypeScript, so widening it never needs an `ALTER TYPE` plus a coordinated
 * deploy. They are read back through the `is*` guards #2391 shipped.
 *
 * **`orderId` carries no foreign key.** It is a cross-aggregate reference by
 * value — the `order_changes` / `refund_records` / `returns.internalOrderId`
 * precedent — which avoids cross-table lock coupling on what is the hottest
 * write path in the wave. `assignedConnectionId` likewise: a work object must
 * outlive the connection that held it, so a deleted connection must not cascade
 * away fulfilment history.
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('fulfillment_works')
// The grouping key. Its LEADING COLUMN serves every `WHERE "orderId" = ?`
// lookup, so there is deliberately no separate (orderId) index — the same
// argument this tree makes against a redundant index on `return_lines`.
// Non-unique on purpose: re-routing legitimately produces a second work row for
// the same (order, location, method) once the first is cancelled, and creation
// idempotency is #2395's to define rather than something to pre-empt with an
// index that is wrong in a way only discoverable months later.
@Index('IDX_fulfillment_works_grouping', ['orderId', 'locationId', 'deliveryMethod'])
// The executor worklist read. Partial: unassigned work is exactly the set this
// lookup can never match.
@Index('IDX_fulfillment_works_assigned_open', ['assignedConnectionId', 'status'], {
  where: '"assignedConnectionId" IS NOT NULL',
})
// ADR-054's timeout-as-rejection sweep scans `requestStatus = 'submitted' AND
// "updatedAt" < ?` across ALL connections. Without this it seq-scans the table
// forever — a defect that only appears under load. Created here although #2399
// owns the sweep: an index is cheap now and a second migration is not.
@Index('IDX_fulfillment_works_request_status', ['requestStatus', 'updatedAt'])
// #2400's inbound-progress correlation read, deferred to #2399 because the
// writer owns the shape (see the `externalWorkId` column docblock for the
// per-connection-vs-intrinsic reasoning). Keyed `(assignedConnectionId,
// externalWorkId)` and NOT `externalWorkId` alone: the value is a THIRD PARTY's
// reference, so two holders may legitimately both mint `"1"`, and an unscoped
// lookup would correlate a webhook from one holder onto another's work.
// Partial: a work carrying no vendor reference is exactly the set this lookup
// can never match. Deliberately NON-unique — see the column docblock.
@Index('IDX_fulfillment_works_external_work_id', ['assignedConnectionId', 'externalWorkId'], {
  where: '"externalWorkId" IS NOT NULL',
})
export class FulfillmentWorkOrmEntity {
  /**
   * `ol_fulfillmentwork_*`, minted by the repository's own
   * `formatFulfillmentWorkId` — NOT by `formatInternalId`, which this leaf
   * cannot value-import from a sibling context. See that function for the
   * trade-off and for the spec that pins the two formats together.
   *
   * No `CoreEntityTypeValues` member and no `ENTITY_TYPE_ID_PREFIX` override are
   * added: that map is `Partial<Record<CoreEntityType, string>>`, so a prettier
   * prefix would first require widening a closed union shared by every adapter,
   * for a cosmetic gain. `returns` (`formatInternalId('Return')`) and inventory
   * locations take exactly this path.
   */
  /**
   * The PK constraint is NAMED to match the migration's `PK_fulfillment_works`.
   *
   * Without `primaryKeyConstraintName`, `synchronize` mints a hash name
   * (`PK_673ee84980642c53c5a5234501e`) while the migration uses the readable
   * one — the two schemas then differ on a constraint name, which is precisely
   * the drift `fulfillment-work-migration-parity.int-spec.ts` exists to catch,
   * and which it did catch. Same discipline as the named `@Check`/`@Index`
   * decorators on these entities.
   */
  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'PK_fulfillment_works' })
  id!: string;

  /** By-value reference to `order_records.internalOrderId`. No FK — see the class docblock. */
  @Column({ type: 'text' })
  orderId!: string;

  /**
   * An `inventory_locations` row id. `null` means **not yet assigned**, never
   * "no location applies" — the router mints work before it has necessarily
   * resolved one, and an observation-only work object on an `omp_fulfilled`
   * topology may never acquire one.
   */
  @Column({ type: 'text', nullable: true })
  locationId!: string | null;

  /**
   * Opaque grouping key; `null` = not yet resolved. `text` rather than
   * `varchar(N)`: the value is adapter-supplied and ADR-054 keeps delivery
   * vocabulary out of this grain, so any length cap is a guess that fails at
   * insert.
   */
  @Column({ type: 'text', nullable: true })
  deliveryMethod!: string | null;

  /** The holder. `null` before assignment and again after a rejection. */
  @Column({ type: 'uuid', nullable: true })
  assignedConnectionId!: string | null;

  /** `FulfillmentWorkStatus`. Narrowed on read by `isFulfillmentWorkStatus`. */
  @Column({ type: 'varchar', length: 32, default: 'open' })
  status!: string;

  /** `FulfillmentRequestStatus`. Narrowed on read by `isFulfillmentRequestStatus`. */
  @Column({ type: 'varchar', length: 32, default: 'unsubmitted' })
  requestStatus!: string;

  /**
   * Monotonic, incremented ONLY by a router-driven re-request (#2399) — never by
   * the job-runner attempt, which changes on exactly the retries the
   * idempotency key must survive.
   */
  @Column({ type: 'integer', default: 0 })
  assignmentAttempt!: number;

  /** `FulfillmentCancellationReason`. Required whenever `status` is `cancelled`. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  cancellationReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  /** At-most-once relay marker. Claimed by #2401; #2392 never writes it. */
  @Column({ type: 'timestamptz', nullable: true })
  dispatchRelayedAt!: Date | null;

  /**
   * The HOLDER's acceptance instant — and the at-most-once CLAIM column for
   * acceptance (#2399, ADR-054).
   *
   * `fulfillment-request-status.types.ts` states the contract verbatim: ADR-054
   * makes acceptance a conditional claim (`WHERE "acceptedAt" IS NULL`), so at
   * most one holder can accept. `recordAcceptance` carries that guard, and it is
   * the guard that survives a future writer moving `requestStatus` without going
   * through that method.
   *
   * Nullable because the VALUE is the holder's own instant and stays `null` when
   * the holder reports none (`FulfillmentRequestResult` property (e) — OL's
   * clock is not a witness to a third party's act). At-most-once therefore comes
   * from the conditional UPDATE, never from the column being populated.
   */
  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  /**
   * The holder's own reference for the work, `null` when it assigns none.
   *
   * Persisted here because it arrives on the `accepted` arm of
   * `FulfillmentRequestResult` and is on that arm's allowlist — #2398 states
   * that a field an adapter adds there is a field core may persist, so this one
   * is admitted deliberately rather than by spread. #2400 reads it to correlate
   * inbound progress back to a work row.
   *
   * ## Intrinsic to the ROW, not a per-connection side table (#2400 deferred
   * this shape here, because the writer knows)
   *
   * Acceptance is an at-most-once claim (`WHERE "acceptedAt" IS NULL`), so at
   * any moment exactly ONE holder has accepted a given work. The reference is
   * therefore a property of this row and needs no `(workId, connectionId)`
   * child table — which would additionally have to answer "which of these is
   * current?" on every read, a question the claim already answers.
   *
   * ## But the LOOKUP is per-connection, which is why the index is composite
   *
   * The value is minted by a third party. Two holders may legitimately both
   * call their first job `"1"`, so a lookup on `externalWorkId` alone would
   * correlate a webhook from one holder onto another holder's work — a
   * cross-tenant misattribution with no error anywhere. `#2400` must therefore
   * resolve `(assignedConnectionId, externalWorkId)`, which is what
   * `IDX_fulfillment_works_external_work_id` serves.
   *
   * ## Non-unique, deliberately
   *
   * Uniqueness is not OL's to assert on a vendor's behalf: nothing in the
   * contract stops a holder reusing a reference after a cancellation, and a
   * unique index would then REFUSE a legitimate acceptance — failing the write
   * that records a real-world commitment, which is the worse direction. The
   * partial-uniqueness-on-live-states shape does not rescue it either, since
   * OL cannot know the vendor retired the old reference. #2400 disambiguates on
   * read by preferring the live row.
   */
  @Column({ type: 'text', nullable: true })
  externalWorkId!: string | null;

  /**
   * Optimistic-concurrency token (#2406). Deliberately a plain integer column
   * and NOT TypeORM's `@VersionColumn`: that decorator only increments on a
   * full-entity `save()`, and this aggregate is written exclusively by narrow
   * conditional UPDATEs, which it would never observe. Each transition carries
   * `version = version + 1` in its own `SET`.
   */
  @Column({ type: 'integer', default: 0 })
  version!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
