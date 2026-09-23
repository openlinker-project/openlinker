/**
 * Bench Parcel Service (#2418, `W3b-5`, spec §§ 2.4–2.5)
 *
 * Opening one box, verifying units into it, and reopening it when it was shut by
 * mistake. Implements {@link IBenchParcelService}.
 *
 * ## Why this lives in `apps/api` rather than in the fulfilment context
 *
 * The same reason #2416's list does. The parcel needs the ORDER's reference and
 * buyer name and the CATALOGUE's product names and barcodes;
 * `libs/core/src/fulfillment` is a registered zero-sibling-edge leaf whose
 * no-injection invariant (ADR-053) forbids it reading either. The join happens
 * here, over published `I*Service` interfaces and never a `*RepositoryPort`.
 * **This adds no core cross-context edge and spends no allow-list entry.**
 *
 * ## Story D2 — one eligibility rule, four shared halves
 *
 * A refusal here reads exactly what the list reads:
 * `BENCH_WORK_STATUSES` / `BENCH_WORK_REQUEST_STATUSES` and
 * `deriveBenchWorkState` (`bench-work-eligibility.ts`), plus
 * `BenchExecutorResolver` for *"assigned to OpenLinker's own packing
 * executor"*, plus — since #3341 — `isClaimableByViewer` for the ADR-074
 * pre-assignment axis. Nothing about eligibility is spelled twice, which is
 * what makes *"the two can never disagree"* structural rather than a promise.
 *
 * A work that is not this bench's at all answers **404** rather than a refusal:
 * a packer has no business reading another executor's parcel contents in order
 * to be told they may not pack them.
 *
 * ## Story D4 — the interrupt cannot fire on an address edit
 *
 * The surface polls this read while a parcel is open and interrupts when
 * `refusal` becomes non-null. The projection carries no address, no email and
 * no phone (see `BenchParcelView` — `totalAmount`/`currency`/`carrierName`/
 * `dispatchByAt` are a deliberate #3409 reversal, not part of this
 * guarantee), so a change to any of the three still-excluded fields is
 * invisible here and cannot produce a diff. That is the guarantee, and it is
 * a property of the field list rather than of a comparison somebody wrote
 * carefully.
 *
 * @module apps/api/src/bench/application/services
 * @implements {IBenchParcelService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  FULFILLMENT_VERIFICATION_SERVICE_TOKEN,
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  type FulfillmentWorkView,
  type IFulfillmentVerificationService,
  type IFulfillmentWorklistService,
  type ParcelVerificationState,
} from '@openlinker/core/fulfillment';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  OrderRecordNotFoundException,
  IOrderRecordService,
} from '@openlinker/core/orders';
import {
  INVENTORY_QUERY_SERVICE_TOKEN,
  type IInventoryQueryService,
} from '@openlinker/core/inventory';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import {
  USER_MANAGEMENT_SERVICE_TOKEN,
  type IUserManagementService,
} from '../../../users/user-management.service.interface';
import {
  SHIPMENT_QUERY_SERVICE_TOKEN,
  ReservationConsumeCandidateStatusValues,
  type IShipmentQueryService,
} from '@openlinker/core/shipping';

import {
  deriveBenchWorkState,
  isBenchWorkSelectable,
  isClaimableByViewer,
} from '../bench-work-eligibility';
import { readBuyerName, readOrderReference } from '../bench-order-facts';
import type {
  BenchCompleteInput,
  BenchUndoCompletionInput,
  BenchReopenInput,
  BenchUndoInput,
  BenchVerifyUnitInput,
  IBenchParcelService,
} from '../interfaces/bench-parcel.service.interface';
import type {
  BenchActivityEntryView,
  BenchClaimResultView,
  BenchCompleteResultView,
  BenchUndoCompletionResultView,
  BenchParcelLineView,
  BenchParcelRefusal,
  BenchParcelView,
  BenchReopenResultView,
  BenchUndoResultView,
  BenchVerificationResultView,
} from '../types/bench-parcel.types';
import { productImageProxyPath } from '../../../products/http/product-image-path';
import { BenchExecutorResolver } from './bench-executor.resolver';

/** Raised when the work is not a parcel this bench may see at all. */
export class BenchParcelNotAtThisBenchError extends Error {
  constructor(public readonly workId: string) {
    super(`Work ${workId} is not packing work at this bench`);
    this.name = 'BenchParcelNotAtThisBenchError';
  }
}

@Injectable()
export class BenchParcelService implements IBenchParcelService {
  private readonly logger = new Logger(BenchParcelService.name);

  constructor(
    private readonly executors: BenchExecutorResolver,
    @Inject(FULFILLMENT_WORKLIST_SERVICE_TOKEN)
    private readonly worklist: IFulfillmentWorklistService,
    @Inject(FULFILLMENT_VERIFICATION_SERVICE_TOKEN)
    private readonly verification: IFulfillmentVerificationService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipments: IShipmentQueryService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventory: IInventoryQueryService,
    // #3424 - the presence heartbeat. Bumped by the ACTS below and never by a
    // read, so a bench tab left open on the rail does not advertise a staffed
    // station; `recordBenchActivity` is best-effort by contract and never
    // throws, so no pack action can fail because of it.
    @Inject(USER_MANAGEMENT_SERVICE_TOKEN)
    private readonly users: IUserManagementService
  ) {}

  async getParcel(workId: string): Promise<BenchParcelView> {
    const work = await this.loadBenchWork(workId);
    const state = await this.verification.getState(workId);
    return await this.project(work, state);
  }

  /**
   * Record that this packer just acted at a bench (#3424).
   *
   * Fired from the four ACTS below - scan, undo, claim, complete - and never
   * from a read, so a bench tab left open on the rail overnight does not keep
   * advertising a staffed station. It is also fired on the REFUSED paths of
   * those acts, deliberately: a packer who scanned the wrong item, or reached
   * a parcel someone else holds, is unambiguously standing at a bench, and
   * reading them as offline for being turned away would be wrong about the
   * one thing this signal exists to say.
   *
   * Awaited rather than fire-and-forget: the underlying call is contractually
   * incapable of rejecting, so awaiting costs one indexed primary-key UPDATE
   * and buys an ordering guarantee - a floating promise could land after the
   * response and leave a test asserting the board's own reading of it flaky.
   */
  private async noteActivity(userId: string): Promise<void> {
    await this.users.recordBenchActivity(userId);
  }

  async getWorkForDocuments(workId: string): Promise<FulfillmentWorkView> {
    return await this.loadBenchWork(workId);
  }

  async verifyUnit(input: BenchVerifyUnitInput): Promise<BenchVerificationResultView> {
    await this.noteActivity(input.verifiedByUserId);
    const work = await this.loadBenchWork(input.workId);

    // Story D2, at the write. A parcel the list would refuse must be refused
    // here too, so a held or cancelled parcel records nothing whatever the
    // packer scans at it.
    //
    // Read BEFORE the transaction, not inside it: a hold placed in the window
    // between this read and the insert is still recorded. That window is narrow
    // and D4's polling interrupt is the real mitigation — the guarantee here is
    // "a parcel already unpackable when the scan arrives records nothing",
    // which is what the story asks for, rather than a serialisable one.
    const refusal = this.refusalFor(work);
    if (refusal !== null) {
      const state = await this.verification.getState(input.workId);
      return {
        outcome: 'refused',
        reason: 'not-packable',
        parcel: await this.project(work, state),
      };
    }

    // ADR-074 (#3336/#3337): a packer excluded from a locked assignment may
    // not RECORD progress on it, whatever the list or `getParcel` chose to
    // show them. This is the actual server-side guarantee — a frontend
    // affordance that hides the scan control is a convenience on top of this,
    // never a substitute for it.
    //
    // Deliberately NOT folded into `refusalFor` / `BenchParcelRefusal`: that
    // rule is VIEWER-INDEPENDENT (status, holds) and is shared with the list's
    // colouring (story D2's "one rule, two callers"). Assignment eligibility
    // depends on WHO is asking, so it reads `isClaimableByViewer` - the SAME
    // predicate #3341's list now colours a row with, and the same one
    // `reopenParcel` below reads too (#3361 review folded that guard's
    // once-separate `isExcludedFromAssignment` helper into this one, so the
    // two write-side guarantees cannot drift apart).
    if (!isClaimableByViewer(work, input.verifiedByUserId)) {
      const state = await this.verification.getState(input.workId);
      return {
        outcome: 'refused',
        // NOT `'not-packable'`, which is what a held or cancelled parcel
        // answers and which the bench renders as "take it back to the
        // trolley". A parcel a supervisor locked mid-pack is perfectly
        // packable - just not by this packer - so sending it back to the
        // trolley would be an operational error, not a wording one.
        reason: 'not-claimable-by-viewer',
        parcel: await this.project(work, state),
      };
    }

    const result = await this.verification.verifyUnit({
      workId: input.workId,
      workLineId: input.workLineId,
      gestureId: input.gestureId,
      verifiedByUserId: input.verifiedByUserId,
    });

    // G2 — the order still has one answer (#2890 F2).
    //
    // This is the derivation D4 describes: the per-work attribution is the
    // detail, and the order-grain fact FOLLOWS from it rather than being a
    // rival to it. Until #2890 it followed from nothing — `markPacked`'s only
    // caller was #2287's manual toggle on `/orders`, so packing at the bench
    // left `order_records.packedAt` untouched and the order-grain fact existed
    // only if a human separately ticked a box.
    // The actor is taken from the STATE that records the close, not from the
    // request that caused it. The two are equal here by construction — this
    // call performed the close — and sourcing it from the recorded fact makes
    // that structural rather than a thing to re-derive when reading.
    if (result.outcome === 'verified' && result.state.closedAt !== null) {
      const packedBy = result.state.packedByUserId;
      if (packedBy !== null) await this.recordOrderPacked(work.orderId, packedBy);
    }

    return {
      outcome: result.outcome,
      reason: result.outcome === 'refused' ? result.reason : null,
      // Re-projected off the state the write itself returned, never a second
      // read: a client that just changed the parcel must not be handed a view
      // assembled from a racing query.
      parcel: await this.project(work, result.state),
    };
  }

  async reopenParcel(input: BenchReopenInput): Promise<BenchReopenResultView> {
    const work = await this.loadBenchWork(input.workId);

    // ADR-074 (#3336/#3337/#3341/#3435 review): the same lock that refuses
    // `verifyUnit` and `undoLastScan` must refuse `reopenParcel` too -
    // otherwise a packer excluded from a locked assignment can reopen a
    // parcel they may not scan into, clearing `packedByUserId` and erasing
    // the record of who packed it. Reads the same `isClaimableByViewer`
    // predicate rather than restating the rule, so the write-side guarantees
    // cannot drift apart. `input.reopenedByUserId` is nullable at this layer
    // (this route's `@CurrentUser()` is optional by design) and the predicate
    // accepts that directly - null never equals a real assignee, so an
    // anonymous reopen against a locked parcel is excluded too.
    if (!isClaimableByViewer(work, input.reopenedByUserId)) {
      const state = await this.verification.getState(input.workId);
      return {
        outcome: 'refused',
        reason: 'not-packable',
        parcel: await this.project(work, state),
      };
    }

    const result = await this.verification.reopenParcel({
      workId: input.workId,
      reopenedByUserId: input.reopenedByUserId,
      expectedVersion: input.expectedVersion,
      // The fact the fulfilment leaf may not read for itself (ADR-053), so the
      // caller that may supplies it. See `hasShipped`.
      hasShipped: await this.hasShipped(input.workId),
    });

    return {
      outcome: result.outcome,
      reason: result.outcome === 'refused' ? result.reason : null,
      parcel: await this.project(work, result.state),
    };
  }

  async listActivity(workId: string): Promise<BenchActivityEntryView[]> {
    const work = await this.loadBenchWork(workId);
    const [events, variants] = await Promise.all([
      this.verification.listVerifications(workId),
      work.lines.length === 0
        ? Promise.resolve([])
        : this.products.getVariantsByIds([
            ...new Set(work.lines.map((line) => line.productVariantId)),
          ]),
    ]);

    const variantById = new Map(variants.map((variant) => [variant.id, variant]));
    const productIds = [...new Set(variants.map((variant) => variant.productId))];
    const products =
      productIds.length === 0 ? [] : await this.products.getProductsByIds(productIds);
    const productById = new Map(products.map((product) => [product.id, product]));
    const lineById = new Map(work.lines.map((line) => [line.id, line]));

    const nameForLine = (workLineId: string): string | null => {
      const line = lineById.get(workLineId);
      const variant = line === undefined ? undefined : variantById.get(line.productVariantId);
      const product = variant === undefined ? undefined : productById.get(variant.productId);
      return product?.name ?? null;
    };

    // One ledger row can produce TWO activity entries — the verify always
    // happened, and a voided row means an undo happened LATER, at a
    // different instant. Splitting them is what lets "verified" and "undone"
    // both appear on the timeline in their own chronological place, rather
    // than collapsing a corrected mistake into a single, misleading row.
    const entries: BenchActivityEntryView[] = [];
    for (const event of events) {
      entries.push({
        workLineId: event.workLineId,
        name: nameForLine(event.workLineId),
        kind: 'verified',
        at: event.verifiedAt.toISOString(),
        byUserId: event.verifiedByUserId,
      });
      if (event.voidedAt !== null) {
        entries.push({
          workLineId: event.workLineId,
          name: nameForLine(event.workLineId),
          kind: 'undone',
          at: event.voidedAt.toISOString(),
          byUserId: event.voidedByUserId,
        });
      }
    }

    // `listVerifications` is already newest-first by `verifiedAt`, which the
    // split above can invalidate (a row's own `undone` entry sorts after its
    // `verified` one, but an OLDER row's undo can still be more recent than
    // a newer row's verify) — so the merged list is re-sorted by its own
    // `at`.
    entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return entries;
  }

  async claimParcel(workId: string, viewerId: string): Promise<BenchClaimResultView> {
    await this.noteActivity(viewerId);
    const work = await this.loadBenchWork(workId);

    const refusal = this.refusalFor(work);
    if (refusal !== null) {
      const state = await this.verification.getState(workId);
      return { outcome: 'refused', reason: refusal, parcel: await this.project(work, state) };
    }

    if (!isClaimableByViewer(work, viewerId)) {
      const state = await this.verification.getState(workId);
      return {
        outcome: 'refused',
        reason: 'not-claimable',
        parcel: await this.project(work, state),
      };
    }

    // An UNASSIGNED parcel is claimed through the guarded transition, so two
    // packers tapping it at the same moment cannot both be told they got it.
    // `updateAssignment` is existence-only guarded by design - ADR-074's
    // advisory model needs it that way for a supervisor's reassignment - so
    // under it both writes landed and both answered `'claimed'`, and the loser
    // walked off with a parcel somebody else was already packing.
    if (work.assignedToUserId === null) {
      const { claimed, work: fresh } = await this.worklist.claimAssignment(workId, viewerId);
      const state = await this.verification.getState(workId);
      return {
        // The FRESH row on both arms, never the pre-write one: on a loss it is
        // what names the actual holder, and on a win it carries the bumped
        // token the caller's next guarded action must send.
        outcome: claimed ? 'claimed' : 'refused',
        reason: claimed ? null : 'claimed-by-someone-else',
        parcel: await this.project(fresh, state),
      };
    }

    // Idempotent: claiming a parcel already assigned to THIS viewer (or
    // assigned elsewhere but still self-serve) writes the identical value
    // again rather than being special-cased, so a double-tap or a retried
    // request is harmless. Deliberately NOT routed through the guarded claim
    // above, which would refuse both of those as "somebody else has it" -
    // including the packer reclaiming their own parcel.
    const claimed = await this.worklist.updateAssignment({
      workId,
      assignedToUserId: viewerId,
    });

    const state = await this.verification.getState(workId);
    return { outcome: 'claimed', reason: null, parcel: await this.project(claimed, state) };
  }

  /**
   * Declare a parcel finished and off the bench (pack-bench completion).
   *
   * Story D2 does NOT apply here — a completed parcel is by definition
   * already closed, so `held`/`cancelled` can never be true of it, and
   * `refusalFor` would answer `null` on every reachable row. What DOES
   * transfer is the ADR-074 lock: the same reason `verifyUnit` re-checks
   * `isClaimableByViewer` rather than trusting a stale list row, this write
   * must too, since a parcel locked to a different packer must not be
   * finished by someone else either.
   */
  async completeParcel(input: BenchCompleteInput): Promise<BenchCompleteResultView> {
    await this.noteActivity(input.completedByUserId);
    const work = await this.loadBenchWork(input.workId);

    if (!isClaimableByViewer(work, input.completedByUserId)) {
      const state = await this.verification.getState(input.workId);
      return {
        outcome: 'refused',
        reason: 'not-claimable-by-viewer',
        parcel: await this.project(work, state),
      };
    }

    const result = await this.verification.complete({
      workId: input.workId,
      completedByUserId: input.completedByUserId,
      expectedVersion: input.expectedVersion,
    });

    if (result.outcome === 'refused') {
      const state = await this.verification.getState(input.workId);
      return { outcome: 'refused', reason: result.reason, parcel: await this.project(work, state) };
    }

    // The claim moved `completedAt` and bumped `version` on the ROW `work`
    // was loaded from before this write — re-fetch, the `claimParcel`
    // precedent, or the projection would report a stale token and a `null`
    // `completedAt` for a completion this very call just recorded.
    const fresh = await this.worklist.get(input.workId);
    const state = await this.verification.getState(input.workId);
    return { outcome: 'completed', reason: null, parcel: await this.project(fresh, state) };
  }

  async undoCompletion(
    input: BenchUndoCompletionInput
  ): Promise<BenchUndoCompletionResultView> {
    const work = await this.loadBenchWork(input.workId);

    // The SAME lock `completeParcel` checks, checked the same way and first.
    // Undoing a completion writes the very column completing it wrote, so if
    // these two ever disagreed a packer locked out of finishing a box could
    // still un-finish one - which is the worse direction, because it takes a
    // parcel back off a shelf somebody else is about to ship.
    if (!isClaimableByViewer(work, input.undoneByUserId)) {
      const state = await this.verification.getState(input.workId);
      return {
        outcome: 'refused',
        reason: 'not-claimable-by-viewer',
        parcel: await this.project(work, state),
      };
    }

    const result = await this.verification.undoCompletion({
      workId: input.workId,
      expectedVersion: input.expectedVersion,
    });

    if (result.outcome === 'refused') {
      const state = await this.verification.getState(input.workId);
      return { outcome: 'refused', reason: result.reason, parcel: await this.project(work, state) };
    }

    // Re-fetched for the reason `completeParcel` re-fetches: the write cleared
    // `completedAt` and bumped `version` on the row `work` was loaded from, so
    // projecting the stale copy would hand back a token that is already dead
    // and a `completedAt` for a completion this call just took back.
    const fresh = await this.worklist.get(input.workId);
    const state = await this.verification.getState(input.workId);
    return { outcome: 'undone', reason: null, parcel: await this.project(fresh, state) };
  }

  async undoLastScan(input: BenchUndoInput): Promise<BenchUndoResultView> {
    await this.noteActivity(input.actorUserId);
    const work = await this.loadBenchWork(input.workId);

    // ADR-074 (#3336/#3337), same rule as `verifyUnit` above: a packer
    // excluded from a locked assignment may not RECORD progress on this
    // parcel, and undoing another packer's recorded scan is recording
    // progress on it just as much as adding one is. Checked before the void
    // rather than left to the core service, which has no viewer to read
    // (#3435 review).
    if (!isClaimableByViewer(work, input.actorUserId)) {
      const state = await this.verification.getState(input.workId);
      return {
        outcome: 'refused',
        reason: 'not-packable',
        workLineId: null,
        parcel: await this.project(work, state),
      };
    }

    const result = await this.verification.voidLastVerification({
      workId: input.workId,
      actorUserId: input.actorUserId,
    });

    return {
      outcome: result.outcome,
      reason: result.outcome === 'refused' ? result.reason : null,
      workLineId: result.outcome === 'voided' ? result.workLineId : null,
      parcel: await this.project(work, result.state),
    };
  }

  /**
   * The order-grain packed fact, derived from the close (#2890 F2, spec G2/D4).
   *
   * ## Why the condition is exactly `verified` + a non-null `closedAt`
   *
   * It is true of precisely the call that performed the close. The load-bearing
   * reason is not the refusal ordering but the DEFAULTING in
   * `FulfillmentVerificationService.verifyUnit`: `closedWork` starts as the
   * work read under the row lock, whose `parcelClosedAt` the `parcel-closed`
   * early return has already proven null, and is replaced only when
   * `claimParcelClose` actually claimed. So an incomplete parcel, a deduplicated
   * gesture, any refusal, and the lost side of a close race all carry a null
   * `closedAt` here. The race's loser skipping this write is correct rather than
   * a miss: the winner performed the close and owns the order-grain write.
   *
   * ## `isFirstPack` is NOT reimplemented here
   *
   * `markPacked`'s repository write is `WHERE packedAt IS NULL`, which IS D10's
   * first-writer-wins. A split order's second parcel therefore affects no row
   * and leaves the first packer's instant and id intact — the whole reason the
   * detailed grain is per work. Re-deriving that guard at this layer would be a
   * second answer to a question the write already answers atomically.
   *
   * ## It fires the T5 `order.packed` automation trigger, and that is intended
   * as of #2890
   *
   * `markPacked` emits T5 on the first pack (`emitPackedTrigger`). Until now the
   * only thing that could fire it was an operator ticking the manual toggle, so
   * a rule armed against T5 — including the two irreversible actions,
   * `issue-sales-document` and `dispatch-shipment` — now fires from a packer's
   * last scan. That is what T5 means: *the order got packed*, and the bench is
   * the surface on which that physically happens. The alternative, a bench pack
   * that does not fire the trigger a manual tick does, would make the automation
   * an operator armed depend on which surface the pack was recorded from. The
   * firing is once per order, not once per parcel, because `isFirstPack` gates
   * it — and a reopen followed by a repack fires nothing further, since the
   * reopen does not clear `order_records.packedAt`.
   *
   * **It fires INLINE, on the packer's request.** `emitPackedTrigger` is awaited
   * inside `markPacked`, so the last scan of a box can wait on whatever a rule
   * dispatches — including issuing a document or buying a label. It cannot FAIL
   * the scan (that emit swallows its own errors), but it can slow it. Awaited
   * rather than fired-and-forgotten deliberately: the order-grain fact must be
   * durable by the time the response says the parcel closed, or any surface
   * reading the order straight afterwards races the write that caused it. If
   * bench latency ever becomes the complaint, the fix is to make the automation
   * emission asynchronous at ITS layer, where every caller benefits, rather than
   * to detach this one call site.
   *
   * ## Best-effort, and never able to fail the pack
   *
   * The close COMMITTED inside the fulfilment context's own transaction before
   * this runs, and two contexts cannot share one — so there is nothing to roll
   * back and the choice is only whether to fail the response. It must not.
   * This is a synchronous request rather than a job, so unlike #2348's release
   * there is no retry ladder to re-drive it; propagating would report a failed
   * pack for a box the packer physically finished, and their retry carries the
   * same gesture id, refuses `parcel-closed`, and never re-attempts this write.
   *
   * The exact precedent is one layer down, in the method being called:
   * `emitPackedTrigger` swallows for the same reason and in the same words —
   * *"never able to fail the pack"*.
   *
   * **Accepted cost, stated rather than implied**: a crash between the committed
   * close and this write loses the order-grain fact permanently. Nothing
   * reconciles it — there is no sweep over
   * `parcelClosedAt IS NOT NULL AND packedAt IS NULL` — and the remedy is
   * #2287's manual toggle. That is the safe direction; the alternative is a 500
   * on a real pack.
   *
   * ## A missing order row is a STATE, not a failure
   *
   * A work object carries its order id by value, so it can legitimately name an
   * order OL never ingested — and `markPacked` raises
   * `OrderRecordNotFoundException` for it. That is logged at `debug`, not
   * `error`: there is no row to have written, and the remedy the error arm
   * names (the manual toggle on `/orders`) does not exist for such an order, so
   * an alertable line would point at an action nobody can take. An error that
   * fires on a healthy install is how people learn to ignore the log.
   */
  private async recordOrderPacked(orderId: string, packedByUserId: string): Promise<void> {
    try {
      await this.orders.markPacked(orderId, packedByUserId);
    } catch (error) {
      if (error instanceof OrderRecordNotFoundException) {
        this.logger.debug(
          `bench_order_packed_no_order_record order=${orderId}: parcel closed and attributed; ` +
            'the order it names was never ingested, so there is no order-grain fact to write.'
        );
        return;
      }
      this.logger.error(
        `bench_order_packed_write_failed order=${orderId}: the parcel is closed and attributed, ` +
          'but the order-grain packed fact was not written. Remedy: the manual packed toggle on /orders.',
        (error as Error).stack
      );
    }
  }

  /**
   * Have the goods left the building? (story E6, decision D19)
   *
   * Reads the shipment(s) linked to THIS work (#2402's `fulfillmentWorkId`) and
   * asks whether any is at a status meaning departure.
   * `ReservationConsumeCandidateStatusValues` is that set, reused verbatim
   * rather than restated — its own docblock defines it as *"the goods left the
   * building"*, and the repository already trusts it for a decision of the same
   * weight (releasing stock OL is still promising).
   *
   * `generated` is deliberately OUTSIDE that set, and the asymmetry is the
   * point: a printed label stuck on a taped box has not necessarily gone
   * anywhere, and refusing a reopen on a label that was merely bought would
   * strand every parcel whose carrier collection is still hours away — the far
   * commoner case at a bench. E6 refuses a box that is GONE, and a bought label
   * is not that.
   *
   * `'outbound'` is passed explicitly: an unstated cohort on an internal flow is
   * a silent decline (#2373), and a return label says nothing about whether this
   * parcel shipped.
   */
  private async hasShipped(workId: string): Promise<boolean> {
    const byWork = await this.shipments.findByFulfillmentWorkIds([workId], 'outbound');
    const departed = new Set<string>(ReservationConsumeCandidateStatusValues);
    return (byWork.get(workId) ?? []).some((shipment) => departed.has(shipment.status));
  }

  /**
   * The work, if it is a parcel this bench may open at all.
   *
   * Three questions, in the order that keeps each refusal honest: does the work
   * exist, is it in the set the list selects, and is it assigned to OpenLinker's
   * own packing executor. All three are the LIST's own rule.
   */
  private async loadBenchWork(workId: string): Promise<FulfillmentWorkView> {
    // Raises `FulfillmentWorkNotFoundError`, which the controller answers 404.
    const work = await this.worklist.get(workId);

    // Story D2's selection half, through the SHARED predicate rather than
    // restated here — the whole reason `isBenchWorkSelectable` was extracted.
    if (
      !isBenchWorkSelectable({
        status: work.status,
        requestStatus: work.requestStatus,
        activeHoldCount: work.activeHolds.length,
      })
    ) {
      throw new BenchParcelNotAtThisBenchError(workId);
    }

    const executors = await this.executors.listPackingExecutors();
    const isOurs =
      work.assignedConnectionId !== null &&
      executors.some((executor) => executor.id === work.assignedConnectionId);
    if (!isOurs) throw new BenchParcelNotAtThisBenchError(workId);

    return work;
  }

  /** Story D2's shared derivation, read as a refusal rather than as a colour. */
  private refusalFor(work: FulfillmentWorkView): BenchParcelRefusal | null {
    const state = deriveBenchWorkState({
      status: work.status,
      requestStatus: work.requestStatus,
      activeHoldCount: work.activeHolds.length,
    });
    return state === 'packable' ? null : state;
  }

  private async project(
    work: FulfillmentWorkView,
    state: ParcelVerificationState
  ): Promise<BenchParcelView> {
    const [order, siblings, lines] = await Promise.all([
      this.orders.findByIds([work.orderId]).then((records) => records[0]),
      this.worklist.listSiblingWorkIds([work.orderId]),
      this.describeLines(work, state),
    ]);

    // A parcel whose siblings could not be read is "1 of 1" rather than "1 of
    // 0": the work in the packer's hands exists, so the count must include it.
    const parcels = siblings.get(work.orderId) ?? [work.id];
    const index = parcels.indexOf(work.id);
    const hold = work.activeHolds[0];

    // Field-by-field, never a spread — see the view type's module note.
    return {
      workId: work.id,
      // From the STATE, never from `work`: the work was loaded before the write
      // and a close or a reopen bumps `version` in SQL, so projecting the
      // pre-write value would hand back a token that is stale on arrival — and
      // the client's very next act, E6's reopen, is the one that needs it.
      version: state.version,
      orderReference: readOrderReference(order) ?? work.orderId,
      buyerName: readBuyerName(order),
      // #3409 (epic #3401) — see the type docblock for why this is now a
      // deliberate reversal of #2413's exclusion rather than an oversight.
      totalAmount: order?.totalAmount ?? null,
      currency: order?.currency ?? null,
      carrierName: order?.sourceDeliveryMethodName ?? null,
      dispatchByAt: order?.dispatchByAt?.toISOString() ?? null,
      parcelIndex: index >= 0 ? index + 1 : 1,
      parcelTotal: parcels.length > 0 ? parcels.length : 1,
      refusal: this.refusalFor(work),
      holdReason: hold?.reason ?? null,
      closedAt: state.closedAt?.toISOString() ?? null,
      packedByUserId: state.packedByUserId,
      // From `work`, unlike `closedAt`/`packedByUserId`/`version` above: none
      // of `verifyUnit` / `reopenParcel` / `undoLastScan` / `claimParcel`
      // writes these three fields, so the work loaded before THIS call's own
      // write (if any) already carries their correct value. The one write
      // that changes `completedAt` — `completeParcel` — re-fetches `work`
      // itself before calling `project`, exactly as `claimParcel` already
      // does for `assignedToUserId`.
      assignedToUserId: work.assignedToUserId,
      invoicePrintedAt: work.invoicePrintedAt?.toISOString() ?? null,
      labelPrintedAt: work.labelPrintedAt?.toISOString() ?? null,
      completedAt: work.completedAt?.toISOString() ?? null,
      lines,
    };
  }

  /**
   * The lines, with the identity a packer matches against the shelf label.
   *
   * Two batched reads for the whole parcel, never one per line — the #2083
   * rule. `ProductVariant` carries no name (that is on `Product`), so the
   * variants resolve their products in a second batched read.
   */
  private async describeLines(
    work: FulfillmentWorkView,
    state: ParcelVerificationState
  ): Promise<BenchParcelLineView[]> {
    const variantIds = [...new Set(work.lines.map((line) => line.productVariantId))];
    const variants = variantIds.length === 0 ? [] : await this.products.getVariantsByIds(variantIds);
    const productIds = [...new Set(variants.map((variant) => variant.productId))];
    const [products, binCodes] = await Promise.all([
      productIds.length === 0 ? Promise.resolve([]) : this.products.getProductsByIds(productIds),
      // #3402/#3410 — one batched read for the whole parcel, never one per line.
      variantIds.length === 0
        ? Promise.resolve(new Map<string, string>())
        : this.inventory.findBinCodesByVariantIds(variantIds),
    ]);

    const variantById = new Map(variants.map((variant) => [variant.id, variant]));
    const productById = new Map(products.map((product) => [product.id, product]));
    const stateByLine = new Map(state.lines.map((line) => [line.workLineId, line]));

    return work.lines.map((line) => {
      const variant = variantById.get(line.productVariantId);
      const product = variant === undefined ? undefined : productById.get(variant.productId);
      const counts = stateByLine.get(line.id);
      return {
        workLineId: line.id,
        productVariantId: line.productVariantId,
        // `null`, never a placeholder that reads like a name: a variant absent
        // from the catalogue is a fact the packer can act on (match the codes),
        // and a fabricated label is not.
        name: product?.name ?? null,
        sku: variant?.sku ?? null,
        ean: variant?.ean ?? null,
        gtin: variant?.gtin ?? null,
        requiredQuantity: counts?.requiredQuantity ?? 0,
        verifiedQuantity: counts?.verifiedQuantity ?? 0,
        // #3410 (epic #3401) — the parent PRODUCT's image; ProductVariant
        // carries none of its own.
        //
        // The PROXY path, never the stored url (pack-bench completion follow-up): what the
        // catalogue sync wrote is the address the BACKEND used to reach the
        // shop, which on a compose deployment the browser cannot resolve at
        // all. See `products/application/services/product-image-proxy.service.ts`.
        imageUrl: productImageProxyPath(product),
        attributes: variant?.attributes ?? null,
        binCode: binCodes.get(line.productVariantId) ?? null,
        weightGrams: variant?.weightGrams ?? null,
        lengthMm: variant?.lengthMm ?? null,
        widthMm: variant?.widthMm ?? null,
        heightMm: variant?.heightMm ?? null,
      };
    });
  }
}
