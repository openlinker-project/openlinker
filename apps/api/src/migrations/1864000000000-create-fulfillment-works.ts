/**
 * Create the fulfillment work tables (#2392, `W3a-3`, ADR-054, DESIGN §5.2).
 *
 * `fulfillment_works` + `fulfillment_work_lines` + `fulfillment_holds` — the
 * unit of fulfilment assignment, its counter-bearing lines, and the first-class
 * hold rows that suspend it.
 *
 * Six choices below are **contract rather than housekeeping**:
 *
 * - **`CHK_fulfillment_work_lines_capacity` is the DB twin of a pure function.**
 *   `checkFulfillmentWorkLineCapacity` (`@openlinker/core/fulfillment`) states
 *   the same rule, and #2392 widened it with the three non-negativity clauses so
 *   the two are genuinely identical on every input rather than merely on the
 *   happy path. They must move together; a row one accepts and the other rejects
 *   is the drift a vocabulary leaf exists to prevent. Declared class-level on
 *   `FulfillmentWorkLineOrmEntity` under the SAME NAME, because the integration
 *   harness builds its schema by `synchronize` and an anonymous @Check would
 *   carry a hash name there.
 *
 * - **`CHK_fulfillment_holds_actor` requires EXACTLY one actor** (`<>`, i.e.
 *   XOR), not at least one. A row claiming both a human and a service placed the
 *   hold is not a richer record, it is an unanswerable audit question. Copied
 *   from `CHK_order_holds_actor`.
 *
 * - **There is deliberately NO `UQ … WHERE "releasedAt" IS NULL` on
 *   `fulfillment_holds`**, and no constraint enforcing the ≤10 active cap.
 *   At-most-one-open is the ORDER grain's rule (`order_holds`); DESIGN §5.2
 *   allows stacking to ten HERE. A partial unique index can only express N=1,
 *   and the only DB construct that could express N>1 is a trigger — which
 *   `synchronize` does not emit, so the cap would hold in production and
 *   silently not in tests, the exact divergence the automation slice declined a
 *   CHECK for. The cap lives in `FulfillmentWorkRepository.placeHold`, which
 *   takes a `FOR UPDATE` lock on the parent work row because counting alone
 *   does not enforce it at READ COMMITTED.
 *
 * - **The two FKs are real and CASCADE; the cross-aggregate references are not.**
 *   `fulfillment_work_lines.fulfillmentWorkId` and
 *   `fulfillment_holds.fulfillmentWorkId` are parts of their parent, so deleting
 *   a work must take them. `orderId`, `productVariantId`, `orderLineId` and
 *   `assignedConnectionId` get indexed references by value with no FK — the
 *   `order_changes` / `refund_records` / `returns.internalOrderId` precedent,
 *   avoiding cross-table lock coupling on a hot write path. `orderLineId` could
 *   not have one in any case: `order_records` has no lines table.
 *
 * - **`IDX_fulfillment_works_request_status` exists for a sweep that does not
 *   exist yet.** ADR-054's timeout-as-rejection sweep (#2399) scans
 *   `requestStatus = 'submitted' AND "updatedAt" < ?` across all connections;
 *   without the index it seq-scans forever, which is a defect that only appears
 *   under load. An index is cheap now and a second migration is not.
 *
 * - **No PG enum on any vocabulary column**, matching the whole tree (zero
 *   `CREATE TYPE … AS ENUM` in `apps/api/src/migrations`). The unions are
 *   enforced in TypeScript, so widening one never needs an `ALTER TYPE` plus a
 *   coordinated deploy, and a rollback past a widened vocabulary is a coercion
 *   miss rather than a hard write failure.
 *
 * `shipment_lines.fulfillmentWorkId` — named in #2392's own acceptance criteria
 * and in DESIGN §5.2 — is **not** added here: no `shipment_lines` table exists
 * on this branch or on `main`. #2391's merged plan already assigns that column
 * to #2402 (`W3a-13`), which owns the wiring.
 *
 * Generated: 2026-08-30 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1863000000000 is #2373's return-line-events timeline index).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFulfillmentWorks1864000000000 implements MigrationInterface {
  name = 'CreateFulfillmentWorks1864000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Line and hold ids default to uuid_generate_v4() — the same guard the
    // neighbouring OMS migrations use.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fulfillment_works" (
        "id" text NOT NULL,
        "orderId" text NOT NULL,
        "locationId" text,
        "deliveryMethod" text,
        "assignedConnectionId" uuid,
        "status" character varying(32) NOT NULL DEFAULT 'open',
        "requestStatus" character varying(32) NOT NULL DEFAULT 'unsubmitted',
        "assignmentAttempt" integer NOT NULL DEFAULT 0,
        "cancellationReason" character varying(64),
        "cancelledAt" TIMESTAMP WITH TIME ZONE,
        "dispatchRelayedAt" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fulfillment_works" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fulfillment_work_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fulfillmentWorkId" text NOT NULL,
        "orderLineId" text NOT NULL,
        "productVariantId" text NOT NULL,
        "totalQuantity" integer NOT NULL,
        "fulfilledQuantity" integer NOT NULL DEFAULT 0,
        "cancelledQuantity" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fulfillment_work_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fulfillment_work_lines_capacity" CHECK (
          "totalQuantity" >= 0 AND "fulfilledQuantity" >= 0 AND "cancelledQuantity" >= 0
          AND "fulfilledQuantity" + "cancelledQuantity" <= "totalQuantity"
        ),
        CONSTRAINT "FK_fulfillment_work_lines_work" FOREIGN KEY ("fulfillmentWorkId")
          REFERENCES "fulfillment_works"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fulfillment_holds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fulfillmentWorkId" text NOT NULL,
        "reason" character varying(64) NOT NULL,
        "note" text,
        "placedByUserId" text,
        "placedByService" text,
        "placedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "releasedAt" TIMESTAMP WITH TIME ZONE,
        "releasedByUserId" text,
        "releaseNote" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fulfillment_holds" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fulfillment_holds_actor" CHECK (
          ("placedByUserId" IS NOT NULL) <> ("placedByService" IS NOT NULL)
        ),
        CONSTRAINT "FK_fulfillment_holds_work" FOREIGN KEY ("fulfillmentWorkId")
          REFERENCES "fulfillment_works"("id") ON DELETE CASCADE
      )
    `);

    // Leading column serves every `WHERE "orderId" = ?`, so no separate
    // (orderId) index is created.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_works_grouping"
        ON "fulfillment_works" ("orderId", "locationId", "deliveryMethod")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_works_assigned_open"
        ON "fulfillment_works" ("assignedConnectionId", "status")
        WHERE "assignedConnectionId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_works_request_status"
        ON "fulfillment_works" ("requestStatus", "updatedAt")
    `);
    // One order line participates in one work exactly once. That pair is the
    // line's identity and the key progress ingress updates on. Its leading
    // column also serves the FK's referential check, so there is no separate
    // index on "fulfillmentWorkId".
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fulfillment_work_lines_work_order_line"
        ON "fulfillment_work_lines" ("fulfillmentWorkId", "orderLineId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_holds_work_active"
        ON "fulfillment_holds" ("fulfillmentWorkId")
        WHERE "releasedAt" IS NULL
    `);
    // UNCONDITIONAL, and not redundant with the partial index above. Postgres
    // cannot use a partial index to satisfy the ON DELETE CASCADE referential
    // check, so without this, deleting a work seq-scans `fulfillment_holds` for
    // its RELEASED rows. `fulfillment_work_lines` needs no equivalent: its
    // UNIQUE index is unconditional and its leading column already serves the
    // check.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_holds_work"
        ON "fulfillment_holds" ("fulfillmentWorkId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_holds_work"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_holds_work_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_fulfillment_work_lines_work_order_line"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_works_request_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_works_assigned_open"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_works_grouping"`);
    // Children before parent — the FKs are CASCADE on delete, not on drop.
    await queryRunner.query(`DROP TABLE IF EXISTS "fulfillment_holds"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fulfillment_work_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fulfillment_works"`);
  }
}
