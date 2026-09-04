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
 * ## Story D2 — one eligibility rule, three shared halves
 *
 * A refusal here reads exactly what the list reads:
 * `BENCH_WORK_STATUSES` / `BENCH_WORK_REQUEST_STATUSES` and
 * `deriveBenchWorkState` (`bench-work-eligibility.ts`), plus
 * `BenchExecutorResolver` for *"assigned to OpenLinker's own packing
 * executor"*. Nothing about eligibility is spelled twice, which is what makes
 * *"the two can never disagree"* structural rather than a promise.
 *
 * A work that is not this bench's at all answers **404** rather than a refusal:
 * a packer has no business reading another executor's parcel contents in order
 * to be told they may not pack them.
 *
 * ## Story D4 — the interrupt cannot fire on an address edit
 *
 * The surface polls this read while a parcel is open and interrupts when
 * `refusal` becomes non-null. The projection carries no address, no email, no
 * phone and no total (see `BenchParcelView`), so a change to any of them is
 * invisible here and cannot produce a diff. That is the guarantee, and it is a
 * property of the field list rather than of a comparison somebody wrote
 * carefully.
 *
 * @module apps/api/src/bench/application/services
 * @implements {IBenchParcelService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FULFILLMENT_VERIFICATION_SERVICE_TOKEN,
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  type FulfillmentWorkView,
  type IFulfillmentVerificationService,
  type IFulfillmentWorklistService,
  type ParcelVerificationState,
} from '@openlinker/core/fulfillment';
import { ORDER_RECORD_SERVICE_TOKEN, IOrderRecordService } from '@openlinker/core/orders';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import {
  SHIPMENT_QUERY_SERVICE_TOKEN,
  ReservationConsumeCandidateStatusValues,
  type IShipmentQueryService,
} from '@openlinker/core/shipping';

import { deriveBenchWorkState, isBenchWorkSelectable } from '../bench-work-eligibility';
import { readBuyerName, readOrderReference } from '../bench-order-facts';
import type {
  BenchReopenInput,
  BenchVerifyUnitInput,
  IBenchParcelService,
} from '../interfaces/bench-parcel.service.interface';
import type {
  BenchParcelLineView,
  BenchParcelRefusal,
  BenchParcelView,
  BenchReopenResultView,
  BenchVerificationResultView,
} from '../types/bench-parcel.types';
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
    private readonly shipments: IShipmentQueryService
  ) {}

  async getParcel(workId: string): Promise<BenchParcelView> {
    const work = await this.loadBenchWork(workId);
    const state = await this.verification.getState(workId);
    return await this.project(work, state);
  }

  async getWorkForDocuments(workId: string): Promise<FulfillmentWorkView> {
    return await this.loadBenchWork(workId);
  }

  async verifyUnit(input: BenchVerifyUnitInput): Promise<BenchVerificationResultView> {
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

    const result = await this.verification.verifyUnit({
      workId: input.workId,
      workLineId: input.workLineId,
      gestureId: input.gestureId,
      verifiedByUserId: input.verifiedByUserId,
    });

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
      parcelIndex: index >= 0 ? index + 1 : 1,
      parcelTotal: parcels.length > 0 ? parcels.length : 1,
      refusal: this.refusalFor(work),
      holdReason: hold?.reason ?? null,
      closedAt: state.closedAt?.toISOString() ?? null,
      packedByUserId: state.packedByUserId,
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
    const products = productIds.length === 0 ? [] : await this.products.getProductsByIds(productIds);

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
      };
    });
  }
}
