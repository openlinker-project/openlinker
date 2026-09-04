/**
 * Fulfillment Work Repository (#2392, ADR-054, DESIGN §5.2/§6.3)
 *
 * Persists the `FulfillmentWork` aggregate. Implements
 * {@link FulfillmentWorkRepositoryPort}.
 *
 * ## Per-column writer table — the point of this file
 *
 * REVIEW C10: `fulfillment_works` is a **five-writer table** (router, executor
 * handshake, progress ingress, operator actions, sweeps). Without per-column
 * ownership that repeats the `order_records` multi-writer problem at a hotter
 * grain. There is therefore **no `save(work)`**. Every column below names its
 * sole writer, and nothing else may write it.
 *
 * | Column | Sole writer | Note |
 * |---|---|---|
 * | `id` / `orderId` | `create` | insert-only; `text NOT NULL`, no DB default |
 * | `locationId` / `deliveryMethod` | `create` | **insert-only** — the router is the single producer. If re-routing mints a NEW row these are never updated; if it ever updates in place, a round-trip from a stale read would silently revert the re-route. Insert-only forces #2395 to choose explicitly |
 * | `assignedConnectionId` | `create`, `assignHolder`, `clearHolder` | settable at insert (ADR-054 R1 creates work ALREADY ASSIGNED, in one transaction); afterwards only the two narrow claims move it |
 * | `status` | `create`, `transitionStatus`, `cancel` | |
 * | `requestStatus` | `create`, `transitionRequestStatus`, `claimDispatchAttempt`, `recordAcceptance`, `recordRejection` | the handshake (#2399) owns it; the router holds a stale copy by construction. A NAMED additional writer is this table's convention (`status` and `assignedConnectionId` each already list three); an UNNAMED one is the defect it guards against |
 * | `assignmentAttempt` | `claimDispatchAttempt` (#2399) | monotonic; a round-trip would reset the idempotency key's stability. #2392's `incrementAssignmentAttempt` is REPLACED, not supplemented: its `WHERE` was `"id" = :id` alone, so any caller could bump the counter out from under a live `submitted` dispatch and invalidate an in-flight key |
 * | `acceptedAt` / `externalWorkId` | `recordAcceptance` (#2399) | ADR-054's at-most-once acceptance CLAIM (`WHERE "acceptedAt" IS NULL`); round-tripping a `null` would re-open the claim |
 * | `dispatchRelayedAt` | `claimDispatchRelay`, `releaseDispatchRelay` (#2401) | at-most-once marker; round-tripping a `null` re-opens the relay. The release is a NAMED second writer — this table's convention (`status` and `requestStatus` each list several); it is the unnamed writer that is the defect |
 * | `cancelledAt` / `cancellationReason` | `cancel` | the `order_records.cancelledAt` precedent |
 * | `expeditedAt` | `setExpedited` (#2416) | one writer, both directions — the instant expedites and `null` releases, guarded `IS NULL` / `IS NOT NULL` so a replay cannot re-stamp a fresh instant and silently reorder two already-expedited parcels against each other |
 * | `version` | every applied HEADER transition | computed in SQL (`version + 1`), never from a caller's read |
 * | `fulfilledQuantity` / `cancelledQuantity` | `recordLineProgress` (#2400) | a create carries zeros and would erase real progress |
 * | `updatedAt` | every applied transition | written IMPLICITLY by TypeORM's `@UpdateDateColumn` injection, and explicitly by `recordLineProgress`. Named here because it has a real downstream consumer — `IDX_fulfillment_works_request_status` and ADR-054's timeout sweep both read it — and a column whose writer is a framework default is exactly the one a writer table must not omit |
 *
 * **`recordLineProgress` deliberately does NOT bump the header's `version`.**
 * It writes `fulfillment_work_lines`, a different row, and the token guards
 * header transitions — bumping it from a line write would make every progress
 * event invalidate an operator's in-flight action token for a field that action
 * never read. The cost is stated rather than hidden: a client holding a version
 * cannot detect that counters moved underneath it, so #2406 must not use
 * `version` alone to decide that a work object is unchanged.
 *
 * **There is no `toOrm` and no raw-SQL upsert here**, and that is deliberate:
 * the write set is spelled per statement, so the exclusion discipline cannot be
 * half-applied. If a raw-SQL upsert is ever added, the same table must be
 * applied to its column tuple as well as to any mapper — `#2101` excluded a
 * column from `toOrm` and left the identical defect in the raw path three lines
 * away, which `#2140` then had to fix.
 *
 * ## Why a conditional UPDATE answers `boolean`
 *
 * `true` = applied. `false` = the precondition no longer held and **nothing was
 * written**. Losing a race is an ordinary outcome, not an error. The `?? 0` on
 * `result.affected` is load-bearing rather than stylistic: an `undefined`
 * affected count coercing to a truthy claim is the silent double-apply shape.
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/repositories
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, QueryFailedError, Repository } from 'typeorm';
import type { EntityManager, UpdateQueryBuilder } from 'typeorm';

import type { HoldReason } from '@openlinker/core/order-lifecycle';
import { Logger } from '@openlinker/shared/logging';

import { DuplicateFulfillmentWorkLineError } from '../../../domain/exceptions/duplicate-fulfillment-work-line.error';
import { FulfillmentHoldAlreadyReleasedError } from '../../../domain/exceptions/fulfillment-hold-already-released.error';
import { FulfillmentHoldLimitExceededError } from '../../../domain/exceptions/fulfillment-hold-limit-exceeded.error';
import { FulfillmentHoldNotFoundError } from '../../../domain/exceptions/fulfillment-hold-not-found.error';
import { FulfillmentPersistenceError } from '../../../domain/exceptions/fulfillment-persistence.error';
import { FulfillmentWorkVersionMismatchError } from '../../../domain/exceptions/fulfillment-work-version-mismatch.error';
import { FulfillmentWorkNotFoundError } from '../../../domain/exceptions/fulfillment-work-not-found.error';
import type {
  CancelFulfillmentWorkInput,
  ClaimFulfillmentDispatchInput,
  CreateFulfillmentWorkInput,
  FulfillmentWorkRepositoryPort,
  FulfillmentWorkTransaction,
  PlaceFulfillmentHoldInput,
  RecordFulfillmentAcceptanceInput,
  RecordFulfillmentLineProgressInput,
  RecordFulfillmentRejectionInput,
  ReleaseFulfillmentHoldInput,
  SetFulfillmentWorkExpeditedInput,
  TransitionFulfillmentRequestStatusInput,
  TransitionFulfillmentWorkStatusInput,
} from '../../../domain/ports/fulfillment-work-repository.port';
import {
  FULFILLMENT_HOLD_ACTIVE_LIMIT,
  type FulfillmentHold,
} from '../../../domain/types/fulfillment-hold.types';
import {
  isFulfillmentRequestStatus,
  type FulfillmentRequestStatus,
} from '../../../domain/types/fulfillment-request-status.types';
import { TERMINAL_FULFILLMENT_WORK_STATUSES } from '../../../domain/types/fulfillment-supported-actions.types';
import {
  isFulfillmentWorkStatus,
  type FulfillmentWorkStatus,
} from '../../../domain/types/fulfillment-work-status.types';
import type { FulfillmentWorkRejection } from '../../../domain/types/fulfillment-work-rejection.types';
import {
  clampWorklistLimit,
  clampWorklistOffset,
  type FulfillmentWorkListFilter,
  type FulfillmentWorkPage,
} from '../../../domain/types/fulfillment-worklist-page.types';
import type {
  FulfillmentWork,
  FulfillmentWorkLine,
} from '../../../domain/types/fulfillment-work.types';
import { FulfillmentHoldOrmEntity } from '../entities/fulfillment-hold.orm-entity';
import { FulfillmentWorkLineOrmEntity } from '../entities/fulfillment-work-line.orm-entity';
import { FulfillmentWorkRejectionOrmEntity } from '../entities/fulfillment-work-rejection.orm-entity';
import { FulfillmentWorkOrmEntity } from '../entities/fulfillment-work.orm-entity';

/**
 * Mints this aggregate's `ol_fulfillmentwork_*` primary key.
 *
 * ## Why this is not `formatInternalId('FulfillmentWork')`
 *
 * It would be, in any other context. `formatInternalId` lives in
 * `@openlinker/core/identifier-mapping` and is a pure formatter, but importing
 * it here is a **VALUE** import of a sibling core context, which
 * `barrel-purity.spec.ts` forbids from a registered zero-sibling-edge leaf
 * unconditionally — and unlike the `HoldReason` type borrow there is no
 * type-only escape, because a formatter is needed at runtime. Every other
 * caller (`returns`, `inventory` locations, `shipping`) sits in a context that
 * is not a leaf and can simply import it.
 *
 * So the FORMAT is reproduced here, deliberately and narrowly. That is a
 * duplication, and it is the smaller of the two available harms: the
 * alternatives were to surrender the leaf property that ADR-053 exists to
 * protect, or to give the aggregate a bare uuid and lose the readable prefix
 * that ends up embedded in `FulfillmentRequest.idempotencyKey`
 * (`work:{workId}:{assignmentAttempt}`) and in every operator-facing log line.
 *
 * **Drift is caught by a test, not by hope**: the spec beside this file imports
 * the real `formatInternalId` — spec files are excluded from the leaf walker —
 * and asserts the two produce the identical shape. If `formatInternalId`
 * changes, that spec fails here.
 */
const formatFulfillmentWorkId = (): string =>
  `ol_fulfillmentwork_${randomUUID().replace(/-/g, '')}`;

/** PostgreSQL `unique_violation`. Matched by code, never by message. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * The first `orderLineId` that appears more than once in a create payload.
 *
 * Returns `''` only when the input genuinely holds no duplicate — which, given
 * the caller reached a `23505` on the line-uniqueness constraint, should be
 * unreachable; it is preferred to a confident wrong id.
 */
const findDuplicateOrderLineId = (lines: readonly { readonly orderLineId: string }[]): string =>
  lines.find((line, index) => lines.findIndex((l) => l.orderLineId === line.orderLineId) !== index)
    ?.orderLineId ?? '';

/**
 * Refuses a counter delta the database would either misparse or accept wrongly.
 *
 * See `recordLineProgress` for the three inputs this exists for. Raised as a
 * plain `RangeError` rather than a domain error because it reports a CALLER
 * DEFECT — a malformed argument — not a domain outcome a caller could handle.
 */
const assertCounterDelta = (field: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `Fulfillment line progress ${field} must be a non-negative integer, received ${String(value)}`
    );
  }
};

@Injectable()
export class FulfillmentWorkRepository implements FulfillmentWorkRepositoryPort {
  private readonly logger = new Logger(FulfillmentWorkRepository.name);

  constructor(
    @InjectRepository(FulfillmentWorkOrmEntity)
    private readonly works: Repository<FulfillmentWorkOrmEntity>,
    @InjectRepository(FulfillmentWorkLineOrmEntity)
    private readonly lines: Repository<FulfillmentWorkLineOrmEntity>,
    @InjectRepository(FulfillmentHoldOrmEntity)
    private readonly holds: Repository<FulfillmentHoldOrmEntity>,
    @InjectRepository(FulfillmentWorkRejectionOrmEntity)
    private readonly rejections: Repository<FulfillmentWorkRejectionOrmEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource
  ) {}

  /**
   * ADR-054 R1's unit of work. `dataSource.transaction` gives us the
   * `EntityManager` that `FulfillmentWorkTransaction` structurally describes, so
   * the port stays framework-free while the caller gets real atomicity.
   */
  async runInTransaction<T>(
    fn: (transaction: FulfillmentWorkTransaction) => Promise<T>
  ): Promise<T> {
    return await this.dataSource.transaction(async (manager) => fn(manager));
  }

  async create(
    input: CreateFulfillmentWorkInput,
    transaction?: FulfillmentWorkTransaction
  ): Promise<FulfillmentWork> {
    // Narrowed here rather than in the port: the port must not name TypeORM
    // (`engineering-standards.md § Domain Layer Independence`), and this is the
    // one place that knows the handle is really an `EntityManager`.
    const manager = transaction as EntityManager | undefined;
    const header = new FulfillmentWorkOrmEntity();
    header.id = formatFulfillmentWorkId();
    header.orderId = input.orderId;
    header.locationId = input.locationId;
    header.deliveryMethod = input.deliveryMethod;
    header.assignedConnectionId = input.assignedConnectionId;
    header.status = input.status ?? 'open';
    header.requestStatus = input.requestStatus ?? 'unsubmitted';
    header.assignmentAttempt = 0;
    header.cancellationReason = null;
    header.cancelledAt = null;
    header.dispatchRelayedAt = null;
    // Never expedited at creation: an expedite is an operator act, and the
    // router that creates work has no opinion about it.
    header.expeditedAt = null;
    header.acceptedAt = null;
    header.externalWorkId = null;
    header.version = 0;

    const lineEntities = input.lines.map((line) => {
      const entity = new FulfillmentWorkLineOrmEntity();
      entity.fulfillmentWorkId = header.id;
      entity.orderLineId = line.orderLineId;
      entity.productVariantId = line.productVariantId;
      entity.totalQuantity = line.totalQuantity;
      entity.fulfilledQuantity = 0;
      entity.cancelledQuantity = 0;
      return entity;
    });

    // Header and lines commit together — a work without its lines is not a
    // work, so a partial write must never be observable. An externally-supplied
    // `manager` is what lets ADR-054 R1 hold: the router creates N work rows AND
    // terminalises the order in ONE transaction, which it could not do if this
    // method always opened its own.
    const run = async (
      em: EntityManager
    ): Promise<{
      savedHeader: FulfillmentWorkOrmEntity;
      savedLines: FulfillmentWorkLineOrmEntity[];
    }> => {
      const savedHeader = await em.save(FulfillmentWorkOrmEntity, header);
      const savedLines =
        lineEntities.length === 0 ? [] : await em.save(FulfillmentWorkLineOrmEntity, lineEntities);
      return { savedHeader, savedLines };
    };

    let saved: {
      savedHeader: FulfillmentWorkOrmEntity;
      savedLines: FulfillmentWorkLineOrmEntity[];
    };
    try {
      const persisted = manager ? await run(manager) : await this.dataSource.transaction(run);
      // Mapped OUTSIDE the try: a bug in `toDomain` is not a persistence
      // failure, and reporting it as one would make
      // `FulfillmentPersistenceError('create', …)` mean two different things.
      saved = persisted;
    } catch (error) {
      // Narrowed to the LINE uniqueness constraint by name. Catching every
      // `23505` here would report a header-table collision as a duplicate line
      // — an error naming a row that is fine, about a table that did not fail.
      if (this.isUniqueViolationOn(error, 'UQ_fulfillment_work_lines_work_order_line')) {
        // The header id is freshly minted, so a collision on this constraint can
        // only mean the CALLER passed the same `orderLineId` twice. Naming the
        // offending one is the whole value of the error, so it is derived rather
        // than defaulted to `lines[0]`.
        throw new DuplicateFulfillmentWorkLineError(
          header.id,
          findDuplicateOrderLineId(input.lines)
        );
      }
      throw new FulfillmentPersistenceError('create', error);
    }

    return this.toDomain(saved.savedHeader, saved.savedLines);
  }

  async findById(workId: string): Promise<FulfillmentWork | null> {
    try {
      const header = await this.works.findOne({ where: { id: workId } });
      if (header === null) return null;
      const lines = await this.lines.find({
        where: { fulfillmentWorkId: workId },
        order: { createdAt: 'ASC' },
      });
      return this.toDomain(header, lines);
    } catch (error) {
      throw new FulfillmentPersistenceError('findById', error);
    }
  }

  async findByOrderId(orderId: string): Promise<FulfillmentWork[]> {
    try {
      const headers = await this.works.find({
        where: { orderId },
        order: { createdAt: 'ASC' },
      });
      if (headers.length === 0) return [];
      const lines = await this.lines.find({
        where: { fulfillmentWorkId: In(headers.map((h) => h.id)) },
        order: { createdAt: 'ASC' },
      });
      return headers.map((header) =>
        this.toDomain(
          header,
          lines.filter((line) => line.fulfillmentWorkId === header.id)
        )
      );
    } catch (error) {
      throw new FulfillmentPersistenceError('findByOrderId', error);
    }
  }

  async transitionStatus(input: TransitionFulfillmentWorkStatusInput): Promise<boolean> {
    // `IN ()` is a syntax error, not an empty set. A transition FROM nothing can
    // never apply, so the honest answer is "not applied" rather than a
    // FulfillmentPersistenceError wrapping a malformed statement.
    if (input.from.length === 0) return false;
    return this.applyGuardedUpdate('transitionStatus', (qb) =>
      this.withVersionGuard(
        qb
          .set({ status: input.to, version: () => '"version" + 1' })
          .where('"id" = :id', { id: input.workId })
          .andWhere('"status" IN (:...from)', { from: [...input.from] }),
        input.expectedVersion
      )
    );
  }

  async transitionRequestStatus(input: TransitionFulfillmentRequestStatusInput): Promise<boolean> {
    // See `transitionStatus` — an empty `from` cannot match, and `IN ()` throws.
    if (input.from.length === 0) return false;
    return this.applyGuardedUpdate('transitionRequestStatus', (qb) =>
      qb
        .set({ requestStatus: input.to, version: () => '"version" + 1' })
        .where('"id" = :id', { id: input.workId })
        .andWhere('"requestStatus" IN (:...from)', { from: [...input.from] })
    );
  }

  async assignHolder(workId: string, connectionId: string): Promise<boolean> {
    // Conditional write — `IS NULL` in the WHERE is what makes this atomic:
    // exactly one router run can claim unassigned work.
    return this.applyGuardedUpdate('assignHolder', (qb) =>
      qb
        .set({ assignedConnectionId: connectionId, version: () => '"version" + 1' })
        .where('"id" = :id', { id: workId })
        .andWhere('"assignedConnectionId" IS NULL')
    );
  }

  async clearHolder(workId: string): Promise<boolean> {
    return this.applyGuardedUpdate('clearHolder', (qb) =>
      qb
        .set({ assignedConnectionId: null, version: () => '"version" + 1' })
        .where('"id" = :id', { id: workId })
        .andWhere('"assignedConnectionId" IS NOT NULL')
    );
  }

  async claimDispatchAttempt(input: ClaimFulfillmentDispatchInput): Promise<number | null> {
    // See `transitionStatus` — an empty `from` cannot match, and `IN ()` is a
    // syntax error rather than an empty set.
    if (input.from.length === 0) return null;

    // ONE statement moves the status and mints the attempt, and the attempt
    // reaches the caller only through this statement's `RETURNING`. Minting an
    // idempotency key without the row already holding that value is therefore
    // not expressible — stronger than asserting call order in a spec.
    //
    // `x = x + 1` in a single UPDATE is atomic at row level, so two concurrent
    // claimants yield 1 and 2, never both 1. No unique index is involved and
    // none would help: an attempt is a COLUMN, not an inserted row. The
    // live-state uniqueness that matters here is the `requestStatus` guard, and
    // at READ COMMITTED the loser blocks on the row lock, re-evaluates the
    // WHERE against the committed row, and matches zero.
    const rows = await this.applyGuardedUpdateReturning('claimDispatchAttempt', (qb) =>
      qb
        .set({
          requestStatus: 'submitted' satisfies FulfillmentRequestStatus,
          assignmentAttempt: () => '"assignmentAttempt" + 1',
          version: () => '"version" + 1',
        })
        .where('"id" = :id', { id: input.workId })
        .andWhere('"requestStatus" IN (:...from)', { from: [...input.from] })
        .returning(['assignmentAttempt'])
    );

    const claimed = rows[0]?.assignmentAttempt;
    return claimed === undefined ? null : Number(claimed);
  }

  async recordAcceptance(input: RecordFulfillmentAcceptanceInput): Promise<boolean> {
    // `acceptedAt IS NULL` is ADR-054's at-most-once acceptance claim, and it is
    // not decoration beside the status guard: it is the conjunct that still
    // holds if a future writer moves `requestStatus` without coming through
    // here. All three columns move in one statement, so an accepted row can
    // never lack the holder's reference.
    return this.applyGuardedUpdate('recordAcceptance', (qb) =>
      qb
        .set({
          requestStatus: 'accepted' satisfies FulfillmentRequestStatus,
          acceptedAt: input.acceptedAt,
          externalWorkId: input.externalWorkId,
          version: () => '"version" + 1',
        })
        .where('"id" = :id', { id: input.workId })
        .andWhere('"requestStatus" = :from', { from: 'submitted' })
        .andWhere('"acceptedAt" IS NULL')
    );
  }

  async recordRejection(input: RecordFulfillmentRejectionInput): Promise<boolean> {
    // TWO writes, ONE transaction. If the guard does not apply, nothing is
    // inserted — otherwise a lost race would leave a rejection row describing a
    // transition that never happened, and the exclusion read would exclude a
    // holder on the strength of an answer another writer had already superseded.
    try {
      return await this.dataSource.transaction(async (em) => {
        const result = await em
          .createQueryBuilder()
          .update(FulfillmentWorkOrmEntity)
          .set({
            requestStatus: 'rejected' satisfies FulfillmentRequestStatus,
            version: () => '"version" + 1',
          })
          .where('"id" = :id', { id: input.workId })
          .andWhere('"requestStatus" = :from', { from: 'submitted' })
          .execute();

        if ((result.affected ?? 0) === 0) return false;

        const rejection = new FulfillmentWorkRejectionOrmEntity();
        rejection.fulfillmentWorkId = input.workId;
        rejection.orderId = input.orderId;
        rejection.connectionId = input.connectionId;
        rejection.assignmentAttempt = input.assignmentAttempt;
        rejection.reason = input.reason;
        rejection.blocking = input.blocking;
        rejection.detail = input.detail;
        rejection.rejectedAt = input.rejectedAt;
        await em.save(FulfillmentWorkRejectionOrmEntity, rejection);

        return true;
      });
    } catch (error) {
      throw new FulfillmentPersistenceError('recordRejection', error);
    }
  }

  async listBlockingRejections(workId: string): Promise<FulfillmentWorkRejection[]> {
    try {
      const rows = await this.rejections.find({
        where: { fulfillmentWorkId: workId, blocking: true },
        order: { rejectedAt: 'DESC' },
      });
      return rows.map((row) => this.toRejectionDomain(row));
    } catch (error) {
      throw new FulfillmentPersistenceError('listBlockingRejections', error);
    }
  }

  async claimDispatchRelay(workId: string, at: Date): Promise<boolean> {
    // The `ShipmentRepository.claimWaybillRelay` shape: `IS NULL` in the WHERE
    // is what makes this atomic under two concurrent triggers. Exactly one
    // UPDATE can affect a row.
    //
    // Routed through `applyGuardedUpdate` rather than `repository.update` so it
    // bumps `version` like every other header transition. It is one: an
    // observer seeing the relay claimed at an UNCHANGED version is the
    // false-negative direction for optimistic concurrency — a stale client's
    // write would be accepted.
    return this.applyGuardedUpdate('claimDispatchRelay', (qb) =>
      qb
        .set({ dispatchRelayedAt: at, version: () => '"version" + 1' })
        .where('"id" = :id', { id: workId })
        .andWhere('"dispatchRelayedAt" IS NULL')
    );
  }

  async releaseDispatchRelay(workId: string): Promise<void> {
    // Conditional on `IS NOT NULL` — see the port's docblock. An unconditional
    // release would bump `version` on a row it did not change; `version` counts
    // state changes, not writes.
    const released = await this.applyGuardedUpdate('releaseDispatchRelay', (qb) =>
      qb
        .set({ dispatchRelayedAt: null, version: () => '"version" + 1' })
        .where('"id" = :id', { id: workId })
        .andWhere('"dispatchRelayedAt" IS NOT NULL')
    );
    if (!released) {
      // Not an error: re-releasing is harmless and the caller may not branch on
      // it. But a claim HOLDER releasing nothing means the row moved underneath
      // it, which is worth seeing.
      this.logger.debug(
        `releaseDispatchRelay: work ${workId} had no relay claim to release (already released or absent)`
      );
    }
  }

  async cancel(input: CancelFulfillmentWorkInput): Promise<boolean> {
    // ADR-054 requires a force-close to land on `cancelled` with a reason,
    // "never `closed`-as-completed" — so the reason is written in the same
    // statement as the status, and a cancelled row can never lack one.
    // Terminal states are excluded from `from`: re-cancelling reports
    // not-applied rather than moving `cancelledAt`.
    //
    // The set is `TERMINAL_FULFILLMENT_WORK_STATUSES`, not a literal (#2675
    // review). It used to be `['cancelled', 'closed']`, which omitted
    // `incomplete` — a status the domain declares terminal ("come to rest and
    // cannot move again") and for which `deriveSupportedActions` therefore
    // withholds `force_cancel`. So the write guard was strictly weaker than the
    // rule it exists to enforce, and nothing could go red on the disagreement:
    // an `incomplete` work reached through a caller that does not re-derive, or
    // through the ordinary race where a work becomes `incomplete` between the
    // derivation and this write, was stamped `cancelled` with a reason and a
    // `cancelledAt`, overwriting the partial-fulfilment disposition it had come
    // to rest in. Reading the exported vocabulary makes a fourth terminal status
    // enrol itself here instead of silently staying cancellable.
    return this.applyGuardedUpdate('cancel', (qb) => {
      const guarded = qb
        .set({
          status: 'cancelled',
          cancellationReason: input.reason,
          cancelledAt: input.cancelledAt,
          version: () => '"version" + 1',
        })
        .where('"id" = :id', { id: input.workId })
        .andWhere('"status" NOT IN (:...terminal)', {
          terminal: [...TERMINAL_FULFILLMENT_WORK_STATUSES],
        });
      return this.withVersionGuard(guarded, input.expectedVersion);
    });
  }

  async setExpedited(input: SetFulfillmentWorkExpeditedInput): Promise<boolean> {
    // The state guard is the OPPOSITE of what is being written, so the two
    // directions are one statement with one predicate shape. Expediting an
    // already-expedited work reports not-applied rather than re-stamping: the
    // instant is the tiebreak between two expedited parcels, and re-stamping it
    // would move this one behind every parcel pushed since — silently, under a
    // packer, which is exactly what D22 says a list must never do.
    //
    // Terminal statuses are excluded for the same reason `deriveSupportedActions`
    // withholds both verbs there: reordering work that will never be packed is
    // noise on a row whose only honest state is "do not pack this". Reading the
    // exported vocabulary rather than a literal makes a fourth terminal status
    // enrol itself here (the `cancel` precedent above).
    const expediting = input.expeditedAt !== null;
    return this.applyGuardedUpdate('setExpedited', (qb) => {
      const guarded = qb
        .set({ expeditedAt: input.expeditedAt, version: () => '"version" + 1' })
        .where('"id" = :id', { id: input.workId })
        .andWhere(expediting ? '"expeditedAt" IS NULL' : '"expeditedAt" IS NOT NULL')
        .andWhere('"status" NOT IN (:...terminal)', {
          terminal: [...TERMINAL_FULFILLMENT_WORK_STATUSES],
        });
      return this.withVersionGuard(guarded, input.expectedVersion);
    });
  }

  async listWorkIdsByOrderIds(orderIds: readonly string[]): Promise<Map<string, string[]>> {
    const byOrder = new Map<string, string[]>();
    // `IN ()` is a syntax error, not an empty set — and an empty ask has an
    // empty answer, so it never reaches the database.
    if (orderIds.length === 0) return byOrder;

    try {
      // Ids and the order id ONLY: this answers "how many parcels does this
      // order have, and which one is this" and nothing else, so hydrating the
      // aggregates would be a second worklist read for a number.
      const rows = await this.works
        .createQueryBuilder('work')
        .select(['work.id', 'work.orderId'])
        .where('work.orderId IN (:...orderIds)', { orderIds: [...orderIds] })
        // The same `createdAt, id` pair `listWorks` uses, and for the same
        // reason: `createdAt` alone is not unique, so without the tiebreak two
        // parcels created in the same millisecond could swap places between two
        // reads and a packer would see "parcel 1 of 2" become "parcel 2 of 2"
        // for the box in their hands.
        .orderBy('work.createdAt', 'ASC')
        .addOrderBy('work.id', 'ASC')
        .getMany();

      for (const row of rows) {
        const bucket = byOrder.get(row.orderId);
        if (bucket === undefined) byOrder.set(row.orderId, [row.id]);
        else bucket.push(row.id);
      }
      return byOrder;
    } catch (error) {
      throw new FulfillmentPersistenceError('listWorkIdsByOrderIds', error);
    }
  }

  async recordLineProgress(input: RecordFulfillmentLineProgressInput): Promise<boolean> {
    // ## Deltas are validated here, then PARAMETERISED — not interpolated.
    //
    // `Number()` would be safe against injection (no number's decimal form
    // contains a quote or an identifier character), but it is not validation,
    // and interpolation fails in the wrong direction for three real inputs that
    // the compile-time `number` type does not stop at an untyped boundary:
    // `NaN` renders as the bare word `NaN`, which Postgres parses as a COLUMN
    // REFERENCE (`column "nan" does not exist`); a fractional delta fails as an
    // integer type error at write time rather than at the boundary; and a
    // negative delta is valid SQL that silently runs the counter BACKWARDS,
    // which the capacity CHECK cannot catch because the result stays in range.
    //
    // So the guard is explicit and the value is bound. The capacity CHECK
    // remains the backstop for over-fulfilment: a delta that would breach it
    // raises rather than silently clamping, because a progress event reporting
    // more than was asked for is a real disagreement with the holder and must
    // not be rounded away.
    assertCounterDelta('fulfilledDelta', input.fulfilledDelta);
    assertCounterDelta('cancelledDelta', input.cancelledDelta);

    try {
      const result = await this.lines
        .createQueryBuilder()
        .update(FulfillmentWorkLineOrmEntity)
        .set({
          fulfilledQuantity: () => '"fulfilledQuantity" + :fulfilledDelta',
          cancelledQuantity: () => '"cancelledQuantity" + :cancelledDelta',
          updatedAt: () => 'now()',
        })
        .setParameters({
          fulfilledDelta: input.fulfilledDelta,
          cancelledDelta: input.cancelledDelta,
        })
        .where('"fulfillmentWorkId" = :workId', { workId: input.workId })
        .andWhere('"orderLineId" = :orderLineId', { orderLineId: input.orderLineId })
        .execute();
      return (result.affected ?? 0) > 0;
    } catch (error) {
      throw new FulfillmentPersistenceError('recordLineProgress', error);
    }
  }

  async placeHold(input: PlaceFulfillmentHoldInput): Promise<FulfillmentHold> {
    try {
      return await this.dataSource.transaction(async (em) => {
        // ## Why the parent row is locked, and why counting alone is not enough
        //
        // Postgres defaults to READ COMMITTED. Two concurrent `placeHold` calls
        // on a work carrying nine active holds each run the count below, each
        // sees 9 (the other's INSERT is uncommitted and therefore invisible),
        // both pass the cap, both insert — and the work ends up with ELEVEN
        // active holds, silently, with no error raised anywhere. An invariant
        // violated with no observable is the worst failure shape available.
        //
        // Being inside a transaction buys nothing on its own: a plain SELECT
        // takes no locks. Nor can `SELECT … FOR UPDATE` over `fulfillment_holds`
        // help — this is a PHANTOM, and the offending rows do not exist yet to
        // be locked. Locking the PARENT `fulfillment_works` row is what
        // serialises count-then-insert per work object, which is the only thing
        // that makes the cap true.
        const parent = await em
          .createQueryBuilder(FulfillmentWorkOrmEntity, 'work')
          .setLock('pessimistic_write')
          .where('work.id = :id', { id: input.workId })
          .getOne();
        if (parent === null) throw new FulfillmentWorkNotFoundError(input.workId);

        // ## The optimistic token, checked under the lock taken above
        //
        // A read-compare is normally read-then-act and racy — but the parent row
        // is held `FOR UPDATE` from here to commit, so no peer can move
        // `version` in between. This is the same serialisation the hold cap
        // relies on, reused rather than a second mechanism.
        if (input.expectedVersion !== undefined && parent.version !== input.expectedVersion) {
          throw new FulfillmentWorkVersionMismatchError(
            input.workId,
            input.expectedVersion,
            parent.version
          );
        }

        const active = await em.count(FulfillmentHoldOrmEntity, {
          where: { fulfillmentWorkId: input.workId, releasedAt: IsNull() },
        });
        if (active >= FULFILLMENT_HOLD_ACTIVE_LIMIT) {
          throw new FulfillmentHoldLimitExceededError(
            input.workId,
            active,
            FULFILLMENT_HOLD_ACTIVE_LIMIT
          );
        }

        const hold = new FulfillmentHoldOrmEntity();
        hold.fulfillmentWorkId = input.workId;
        hold.reason = input.reason;
        hold.note = input.note ?? null;
        hold.placedByUserId = input.placedByUserId ?? null;
        hold.placedByService = input.placedByService ?? null;
        hold.placedAt = input.placedAt;
        hold.releasedAt = null;
        hold.releasedByUserId = null;
        hold.releaseNote = null;

        const saved = await em.save(FulfillmentHoldOrmEntity, hold);

        // Placing a hold IS a state change: it adds `release_hold` and
        // suppresses every forward-motion action. Leaving `version` still while
        // `supportedActions` moved is the false-negative direction for
        // optimistic concurrency — `claimDispatchRelay` names it in those words
        // — and would let a stale client's next write through.
        await em.increment(FulfillmentWorkOrmEntity, { id: input.workId }, 'version', 1);

        return this.toHoldDomain(saved);
      });
    } catch (error) {
      if (
        error instanceof FulfillmentHoldLimitExceededError ||
        error instanceof FulfillmentWorkNotFoundError ||
        error instanceof FulfillmentWorkVersionMismatchError
      ) {
        throw error;
      }
      throw new FulfillmentPersistenceError('placeHold', error);
    }
  }

  async releaseHold(input: ReleaseFulfillmentHoldInput): Promise<FulfillmentHold> {
    try {
      return await this.dataSource.transaction(async (em) => {
        // The hold is located first because it is what carries the work id —
        // `workId` on the input is optional, and a caller passing no
        // `expectedVersion` has no reason to supply it.
        const existing = await em.findOne(FulfillmentHoldOrmEntity, {
          where: { id: input.holdId },
        });
        if (existing === null) throw new FulfillmentHoldNotFoundError(input.holdId);

        const workId = input.workId ?? existing.fulfillmentWorkId;

        // ## The optimistic token, checked under a lock — the `placeHold` shape
        //
        // Only taken when a token was supplied: an unguarded caller pays no
        // lock. Held `FOR UPDATE` to commit, so the compare is not read-then-act.
        if (input.expectedVersion !== undefined) {
          const parent = await em
            .createQueryBuilder(FulfillmentWorkOrmEntity, 'work')
            .setLock('pessimistic_write')
            .where('work.id = :id', { id: workId })
            .getOne();
          if (parent === null) throw new FulfillmentWorkNotFoundError(workId);
          if (parent.version !== input.expectedVersion) {
            throw new FulfillmentWorkVersionMismatchError(
              workId,
              input.expectedVersion,
              parent.version
            );
          }
        }

        // Conditional on `releasedAt IS NULL`: `affected` and the returned row
        // cannot disagree, and there is no read-after-write.
        const result = await em
          .createQueryBuilder()
          .update(FulfillmentHoldOrmEntity)
          .set({
            releasedAt: input.releasedAt,
            releasedByUserId: input.releasedByUserId ?? null,
            releaseNote: input.releaseNote ?? null,
          })
          .where('"id" = :id AND "releasedAt" IS NULL', { id: input.holdId })
          .returning('*')
          .execute();

        const rows = result.raw as FulfillmentHoldOrmEntity[];
        if (rows.length === 0) {
          // Zero rows now has ONE remaining cause — the hold exists (checked
          // above) and was already released. A benign double-release and a
          // dangling id stay different facts, reported by different errors.
          //
          // `existing.releasedAt` cannot be null here, but falling back to the
          // CALLER's timestamp would report a fabricated moment of release as an
          // audit fact, so the impossible branch is reported as itself.
          if (existing.releasedAt === null) {
            throw new FulfillmentPersistenceError(
              'releaseHold',
              new Error(
                `Hold ${input.holdId} matched no conditional update yet reads as unreleased`
              )
            );
          }
          throw new FulfillmentHoldAlreadyReleasedError(input.holdId, existing.releasedAt);
        }

        // Releasing a hold is a state change for the same reason placing one is:
        // it restores forward-motion actions. See `placeHold`.
        await em.increment(FulfillmentWorkOrmEntity, { id: workId }, 'version', 1);

        return this.toHoldDomain(rows[0]);
      });
    } catch (error) {
      if (
        error instanceof FulfillmentHoldNotFoundError ||
        error instanceof FulfillmentHoldAlreadyReleasedError ||
        error instanceof FulfillmentWorkNotFoundError ||
        error instanceof FulfillmentWorkVersionMismatchError ||
        error instanceof FulfillmentPersistenceError
      ) {
        throw error;
      }
      throw new FulfillmentPersistenceError('releaseHold', error);
    }
  }

  async listWorks(filter: FulfillmentWorkListFilter): Promise<FulfillmentWorkPage> {
    try {
      // Clamped HERE as well as in the request DTO. Reported === enforced: a
      // caller that bypasses the HTTP boundary (a worker, a future MCP tool)
      // must not be able to ask for an unbounded page either.
      const limit = clampWorklistLimit(filter.limit);
      const offset = clampWorklistOffset(filter.offset);

      const qb = this.works.createQueryBuilder('work');
      if (filter.status !== undefined && filter.status.length > 0) {
        qb.andWhere('work.status IN (:...status)', { status: [...filter.status] });
      }
      if (filter.requestStatus !== undefined && filter.requestStatus.length > 0) {
        qb.andWhere('work.requestStatus IN (:...requestStatus)', {
          requestStatus: [...filter.requestStatus],
        });
      }
      if (filter.locationId !== undefined) {
        qb.andWhere('work.locationId = :locationId', { locationId: filter.locationId });
      }
      if (filter.orderId !== undefined) {
        qb.andWhere('work.orderId = :orderId', { orderId: filter.orderId });
      }
      if (filter.assignedConnectionId !== undefined) {
        // An EMPTY list means "these zero connections", never "any" — see the
        // filter's own docblock. `IN ()` is a Postgres syntax error rather than
        // an empty set, so it is spelled as an always-false predicate instead of
        // being dropped: dropping it would widen the page to every executor's
        // work, which for the bench caller is the one wrong answer.
        if (filter.assignedConnectionId.length === 0) {
          qb.andWhere('1 = 0');
        } else {
          qb.andWhere('work.assignedConnectionId IN (:...assignedConnectionId)', {
            assignedConnectionId: [...filter.assignedConnectionId],
          });
        }
      }

      // `createdAt` alone is not unique, so a page boundary landing inside a
      // same-timestamp run would drop or repeat rows between pages. The id is
      // the tiebreak that makes the page stable.
      //
      // The direction is the caller's (#2416) and defaults to DESC, which is
      // what this read has always done. It decides WHICH rows a truncated page
      // contains, not merely their order — see `FulfillmentWorkListFilter.orderBy`.
      const direction = filter.orderBy === 'createdAt_ASC' ? 'ASC' : 'DESC';
      const [headers, total] = await qb
        .orderBy('work.createdAt', direction)
        .addOrderBy('work.id', direction)
        .take(limit)
        .skip(offset)
        .getManyAndCount();

      if (headers.length === 0) return { works: [], total };

      // One query for the page's lines, not one per work.
      const lines = await this.lines.find({
        where: { fulfillmentWorkId: In(headers.map((header) => header.id)) },
        order: { createdAt: 'ASC' },
      });
      const linesByWork = new Map<string, FulfillmentWorkLineOrmEntity[]>();
      for (const line of lines) {
        const bucket = linesByWork.get(line.fulfillmentWorkId);
        if (bucket === undefined) linesByWork.set(line.fulfillmentWorkId, [line]);
        else bucket.push(line);
      }

      return {
        works: headers.map((header) => this.toDomain(header, linesByWork.get(header.id) ?? [])),
        total,
      };
    } catch (error) {
      throw new FulfillmentPersistenceError('listWorks', error);
    }
  }

  async listActiveHoldsForWorks(
    workIds: readonly string[]
  ): Promise<Map<string, FulfillmentHold[]>> {
    const byWork = new Map<string, FulfillmentHold[]>();
    // `In([])` is an empty-set query rather than a syntax error, but issuing it
    // at all is pointless; short-circuiting also keeps the caller's page-of-zero
    // path free of a round trip.
    if (workIds.length === 0) return byWork;

    try {
      const rows = await this.holds.find({
        where: { fulfillmentWorkId: In([...workIds]), releasedAt: IsNull() },
        order: { placedAt: 'ASC' },
      });
      for (const row of rows) {
        const hold = this.toHoldDomain(row);
        const bucket = byWork.get(row.fulfillmentWorkId);
        if (bucket === undefined) byWork.set(row.fulfillmentWorkId, [hold]);
        else bucket.push(hold);
      }
      return byWork;
    } catch (error) {
      throw new FulfillmentPersistenceError('listActiveHoldsForWorks', error);
    }
  }

  async listActiveHolds(workId: string): Promise<FulfillmentHold[]> {
    try {
      const rows = await this.holds.find({
        where: { fulfillmentWorkId: workId, releasedAt: IsNull() },
        order: { placedAt: 'ASC' },
      });
      return rows.map((row) => this.toHoldDomain(row));
    } catch (error) {
      throw new FulfillmentPersistenceError('listActiveHolds', error);
    }
  }

  /**
   * The one place a guarded UPDATE on `fulfillment_works` is issued, so the
   * `?? 0` and the error conversion cannot be forgotten per transition.
   */
  /**
   * Attach the optimistic-concurrency precondition to a conditional UPDATE.
   *
   * Applied to the SAME statement as the state guard, which is the whole design
   * (#2406 / REVIEW C10): the state predicate, the version predicate and the
   * write commit together, so no window exists between checking the token and
   * using it. A separate claim-then-act would both reverse `version`'s
   * "counts state changes, not writes" contract and leave that window open.
   *
   * `undefined` attaches nothing, which is what keeps every pre-#2406 caller
   * byte-identical.
   */
  private withVersionGuard(
    qb: UpdateQueryBuilder<FulfillmentWorkOrmEntity>,
    expectedVersion: number | undefined
  ): UpdateQueryBuilder<FulfillmentWorkOrmEntity> {
    if (expectedVersion === undefined) return qb;
    return qb.andWhere('"version" = :expectedVersion', { expectedVersion });
  }

  private async applyGuardedUpdate(
    operation: string,
    build: (
      qb: UpdateQueryBuilder<FulfillmentWorkOrmEntity>
    ) => UpdateQueryBuilder<FulfillmentWorkOrmEntity>
  ): Promise<boolean> {
    try {
      const base = this.works.createQueryBuilder().update(FulfillmentWorkOrmEntity);
      const result = await build(base).execute();
      return (result.affected ?? 0) > 0;
    } catch (error) {
      throw new FulfillmentPersistenceError(operation, error);
    }
  }

  /**
   * The RETURNING sibling of `applyGuardedUpdate`.
   *
   * A SEPARATE method rather than a widened signature on the shared helper:
   * that one answers `boolean` and seven callers depend on it, and its docblock
   * exists precisely so the `?? 0` and the error conversion cannot be forgotten
   * per transition. Widening a discipline-carrying choke point so one caller can
   * read a column back would erode the discipline for the other seven. The two
   * share the shape and the error translation; only the projection differs.
   */
  private async applyGuardedUpdateReturning(
    operation: string,
    build: (
      qb: UpdateQueryBuilder<FulfillmentWorkOrmEntity>
    ) => UpdateQueryBuilder<FulfillmentWorkOrmEntity>
  ): Promise<Array<Partial<FulfillmentWorkOrmEntity>>> {
    try {
      const base = this.works.createQueryBuilder().update(FulfillmentWorkOrmEntity);
      const result = await build(base).execute();
      // `raw` is `any` from TypeORM; an unapplied UPDATE returns an empty array
      // rather than a row, which is what makes `rows[0]` the claim test.
      const raw: unknown = result.raw;
      return Array.isArray(raw) ? (raw as Array<Partial<FulfillmentWorkOrmEntity>>) : [];
    } catch (error) {
      throw new FulfillmentPersistenceError(operation, error);
    }
  }

  private toRejectionDomain(entity: FulfillmentWorkRejectionOrmEntity): FulfillmentWorkRejection {
    return {
      id: entity.id,
      fulfillmentWorkId: entity.fulfillmentWorkId,
      orderId: entity.orderId,
      connectionId: entity.connectionId,
      assignmentAttempt: Number(entity.assignmentAttempt),
      reason: entity.reason,
      blocking: entity.blocking,
      detail: entity.detail,
      rejectedAt: entity.rejectedAt,
    };
  }

  /**
   * Whether `error` is a unique violation on ONE named constraint.
   *
   * Constraint-scoped rather than code-scoped: a bare `23505` test would let a
   * collision on any other index — present or future — be reported as this
   * one's domain error. A `QueryFailedError` carrying any other code or
   * constraint still propagates untranslated, deliberately: a repository that
   * swallowed every database error would be worse than one that leaked.
   */
  private isUniqueViolationOn(error: unknown, constraint: string): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    // `QueryFailedError.driverError` is typed `any`, so it is narrowed through
    // `unknown` rather than an intersection cast — the intersection would leave
    // every member access unsafe.
    const readString = (source: unknown, key: 'code' | 'constraint'): string | undefined => {
      if (typeof source !== 'object' || source === null) return undefined;
      const value = (source as Record<string, unknown>)[key];
      return typeof value === 'string' ? value : undefined;
    };

    const driverError = (error as { driverError?: unknown }).driverError;
    const code = readString(error, 'code') ?? readString(driverError, 'code');
    const name = readString(error, 'constraint') ?? readString(driverError, 'constraint');
    return code === PG_UNIQUE_VIOLATION && name === constraint;
  }

  private toDomain(
    header: FulfillmentWorkOrmEntity,
    lines: FulfillmentWorkLineOrmEntity[]
  ): FulfillmentWork {
    return {
      id: header.id,
      orderId: header.orderId,
      locationId: header.locationId,
      deliveryMethod: header.deliveryMethod,
      assignedConnectionId: header.assignedConnectionId,
      // Narrow-or-fallback, never a blind cast — both guards ship in this same
      // context (#2391), so unlike `HoldReason` there is no leaf constraint
      // here. A row written by a newer release and rolled back reads as the
      // initial state rather than as an unrenderable value.
      status: isFulfillmentWorkStatus(header.status)
        ? header.status
        : ('open' satisfies FulfillmentWorkStatus),
      requestStatus: isFulfillmentRequestStatus(header.requestStatus)
        ? header.requestStatus
        : ('unsubmitted' satisfies FulfillmentRequestStatus),
      assignmentAttempt: Number(header.assignmentAttempt),
      cancellationReason:
        header.cancellationReason === null
          ? null
          : (header.cancellationReason as FulfillmentWork['cancellationReason']),
      version: Number(header.version),
      cancelledAt: header.cancelledAt,
      dispatchRelayedAt: header.dispatchRelayedAt,
      expeditedAt: header.expeditedAt,
      acceptedAt: header.acceptedAt,
      externalWorkId: header.externalWorkId,
      lines: lines.map((line) => this.toLineDomain(line)),
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
    };
  }

  private toLineDomain(entity: FulfillmentWorkLineOrmEntity): FulfillmentWorkLine {
    return {
      id: entity.id,
      orderLineId: entity.orderLineId,
      productVariantId: entity.productVariantId,
      // `integer` comes back from pg as a number already, but a DEFAULT-ed
      // column read through an older row could be undefined; coerce once here.
      totalQuantity: Number(entity.totalQuantity),
      fulfilledQuantity: Number(entity.fulfilledQuantity),
      cancelledQuantity: Number(entity.cancelledQuantity),
    };
  }

  private toHoldDomain(entity: FulfillmentHoldOrmEntity): FulfillmentHold {
    return {
      id: entity.id,
      fulfillmentWorkId: entity.fulfillmentWorkId,
      // Cast, not narrowed — `isHoldReason` is a VALUE import from a sibling
      // context, which `barrel-purity.spec.ts` forbids from a registered
      // zero-sibling-edge leaf unconditionally. The write path keeps this
      // honest: the port accepts a `HoldReason`, so every row this context
      // writes is valid by construction. See `domain/types/fulfillment-hold.types.ts`.
      reason: entity.reason as HoldReason,
      note: entity.note,
      placedByUserId: entity.placedByUserId,
      placedByService: entity.placedByService,
      placedAt: entity.placedAt,
      releasedAt: entity.releasedAt,
      releasedByUserId: entity.releasedByUserId,
      releaseNote: entity.releaseNote,
    };
  }
}
