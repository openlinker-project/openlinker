/**
 * Inventory Sale Decrement Service (#3453, epic #3460)
 *
 * With the OMS on, a routed order stays in OpenLinker and is never created in the
 * product master, so nothing lowered the master's stock for the sale — the last
 * unit sold on Allegro while the shop, its storefront and every other
 * marketplace kept showing it in stock. This service lowers it: once per work
 * line, in the product master that OWNS the line, and then publishes the new
 * number to every marketplace straight away.
 *
 * ## Order of operations per line, and why
 *
 * 1. **Owner** — resolved from the non-stale position's `sourceConnectionId`
 *    ({@link resolveSaleDecrementOwner}). A structural refusal is persisted as
 *    `blocked` and never crosses the boundary.
 * 2. **Source-is-owner skip** — an order ingested through the line's own shop
 *    already lowered that shop's stock in its own order flow. Persisted as
 *    `skipped`, never a silent no-op: routing applies to every `OrderSource`,
 *    so without it every storefront sale would be counted twice. (#3487 stops
 *    such orders being routed at all; this is the safety net.)
 * 3. **Existing row** — a replay finds its row and reports it without building
 *    an adapter. A row still `pending` means a previous run died mid-call; it
 *    becomes `in_doubt` and is never re-sent.
 * 4. **Adapter** — built BEFORE claiming. A failure here provably crossed
 *    nothing, so the line is `retryable` and the caller retries the job.
 * 5. **Claim** — the atomic Postgres claim, written before the boundary. This is
 *    the guarantee, not the adapter's own key: it holds when the adapter reports
 *    `idempotency: 'unsupported'`, and a crash between the write and the
 *    adapter's own remember step cannot apply it twice.
 * 6. **Write** — `adjustInventory(-n)`, keyed `sale:{owner}:{workId}:{lineId}`,
 *    with no `locationId` (OpenLinker's location id is not the adapter's — the
 *    Subiekt adapter reads it as a `magazynId`).
 * 7. **Close the hold** (#3480) — the line's advisory hold is consumed BEFORE the
 *    mirror write, so the reduction moves from the hold to the master exactly
 *    once — not even for the moment between the two writes, which is why this
 *    step runs before step 8 rather than after it. A failed decrement never
 *    reaches here, so its hold keeps the stock reduced while the retry runs.
 * 8. **Mirror + propagate** — the master's new quantity is written to
 *    `inventory_items` through `setInventory`, which enqueues
 *    `inventory.propagateToMarketplaces`.
 *
 * Any throw from the write is `in_doubt`, paired with a best-effort re-read of
 * the master's stock so the marketplaces show its real number whichever way the
 * write went. See `inventory-sale-decrement.types.ts` for why an unknown outcome
 * is never retried automatically.
 *
 * Steps 5–8 for one `(owner, product, variant)` position run under
 * {@link saleDecrementPositionLockKey}: the `realtime` lane runs concurrently
 * (#2278), so two works for the same position can genuinely both apply, and
 * without the lock their two mirror writes can land out of order.
 *
 * **A failed hold-close is reported and retried, not silently declared healed
 * (#3491 review).** Step 7 never undoes the decrement — it is already durable —
 * so `consumeHold` and `consumeHoldIfSettled` never throw; instead they return
 * `false`, which the caller collects into `DecrementForWorkResult.holdCloseFailedLineIds`.
 * The handler throws a retryable error when that set is non-empty, and the
 * NEXT run's replay path (§3 above) re-enters `consumeHoldIfSettled` against the
 * now-settled row — that replay call is the only path that can actually heal a
 * failed close, so it must be reachable rather than merely described.
 *
 * @module libs/core/src/inventory/application/services
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { InventoryItem } from '../../domain/entities/inventory-item.entity';
import type { InventorySaleDecrement } from '../../domain/entities/inventory-sale-decrement.entity';
import type {
  InventoryAdjustmentResult,
  InventoryMasterPort,
} from '../../domain/ports/inventory-master.port';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import {
  InventorySaleDecrementRepositoryPort,
  type SaleDecrementLineRef,
  type SaleDecrementSettlement,
} from '../../domain/ports/inventory-sale-decrement-repository.port';
import type { InventoryOwnerPosition } from '../../domain/types/inventory.types';
import {
  buildSaleDecrementIdempotencyKey,
  buildUnresolvedSaleDecrementKey,
  deriveSaleDecrementAttention,
  resolveSaleDecrementOwner,
  saleDecrementPositionLockKey,
  SALE_DECREMENT_POSITION_LOCK_TTL_MS,
} from '../../domain/types/inventory-sale-decrement.types';
import {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  RESERVATION_SERVICE_TOKEN,
} from '../../inventory.tokens';
import { IInventoryService } from './inventory.service.interface';
import { IReservationService } from './reservation.service.interface';
import type {
  DecrementForWorkInput,
  DecrementForWorkResult,
  IInventorySaleDecrementService,
  SaleDecrementLineInput,
  SaleDecrementLineOutcome,
} from './inventory-sale-decrement.service.interface';

/** An owner's adapter, or the reason it could not be built. */
type AdapterResolution =
  | { readonly adapter: InventoryMasterPort }
  | { readonly error: string };

@Injectable()
export class InventorySaleDecrementService implements IInventorySaleDecrementService {
  private readonly logger = new Logger(InventorySaleDecrementService.name);

  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN)
    private readonly decrements: InventorySaleDecrementRepositoryPort,
    @Inject(INVENTORY_SERVICE_TOKEN)
    private readonly inventoryService: IInventoryService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    @Inject(RESERVATION_SERVICE_TOKEN)
    private readonly reservations: IReservationService
  ) {}

  async decrementForWork(input: DecrementForWorkInput): Promise<DecrementForWorkResult> {
    const productIds = [...new Set(input.lines.map((line) => line.productId))];
    const positions = await this.inventoryRepository.findLiveOwnerPositions(productIds);

    // One adapter per owner per run: a two-master basket builds two, never one
    // per line.
    const adapters = new Map<string, Promise<AdapterResolution>>();
    const outcomes: SaleDecrementLineOutcome[] = [];
    const holdCloseFailedLineIds: string[] = [];

    for (const line of input.lines) {
      if (line.quantity <= 0) {
        // Should be unreachable — the table's own CHECK and a work line's
        // counters both forbid a non-positive quantity — which is exactly why
        // silently dropping it here is wrong: an unreachable branch that fails
        // silently is how it stops being unreachable.
        this.logger.warn(
          `Sale decrement skipped a non-positive quantity: orderId=${input.orderId} ` +
            `workId=${input.workId} line=${line.orderLineId} quantity=${String(line.quantity)}`
        );
        continue;
      }
      outcomes.push(
        await this.decrementLine(input, line, positions, adapters, holdCloseFailedLineIds)
      );
    }

    const rows = await this.decrements.findByOrderId(input.orderId);

    return {
      lines: outcomes,
      retryableLineIds: outcomes
        .filter((outcome) => outcome.status === 'retryable')
        .map((outcome) => outcome.orderLineId),
      holdCloseFailedLineIds,
      attention: deriveSaleDecrementAttention(rows, holdCloseFailedLineIds.length),
    };
  }

  private async decrementLine(
    input: DecrementForWorkInput,
    line: SaleDecrementLineInput,
    positions: readonly InventoryOwnerPosition[],
    adapters: Map<string, Promise<AdapterResolution>>,
    holdCloseFailedLineIds: string[]
  ): Promise<SaleDecrementLineOutcome> {
    const resolution = resolveSaleDecrementOwner(positions, {
      productId: line.productId,
      productVariantId: line.productVariantId,
      locationId: input.locationId,
    });

    if (resolution.kind === 'blocked') {
      const ref = this.lineRef(
        input,
        line,
        null,
        buildUnresolvedSaleDecrementKey(input.workId, line.orderLineId)
      );
      await this.decrements.recordUnclaimed(ref, {
        status: 'blocked',
        reason: resolution.reason,
        detail: resolution.detail,
      });
      this.logger.warn(
        `Sale decrement blocked before the product master: orderId=${input.orderId} ` +
          `workId=${input.workId} line=${line.orderLineId} reason=${resolution.reason}`
      );
      return this.reportRow(line, await this.decrements.findByKey(ref.idempotencyKey), false);
    }

    const owner = resolution.ownerConnectionId;
    const ref = this.lineRef(
      input,
      line,
      owner,
      buildSaleDecrementIdempotencyKey(owner, input.workId, line.orderLineId)
    );

    if (owner === input.orderSourceConnectionId) {
      await this.decrements.recordUnclaimed(ref, {
        status: 'skipped',
        reason: 'source-is-owner',
        detail: 'the order came from this product master, which lowered its own stock',
      });
      const row = await this.decrements.findByKey(ref.idempotencyKey);
      // The shop already lowered its own stock, so the hold must stop counting
      // too, or the sale would be subtracted twice (#3480).
      if (!(await this.consumeHoldIfSettled(input.orderId, line.orderLineId, row))) {
        holdCloseFailedLineIds.push(line.orderLineId);
      }
      return this.reportRow(line, row, false);
    }

    // Everything from here on can write the mirror for this position — the
    // replay path (an interrupted claim re-reads the master) as well as the
    // fresh-write path — so it all runs under one lock keyed on the position,
    // never on this line's own idempotency key. Two overlapping works for the
    // SAME position each claim distinct keys and both correctly apply; the
    // lock is what orders their two mirror writes instead of letting the
    // slower call's stale answer land last. See
    // `saleDecrementPositionLockKey` for why #2617's freshness guard cannot
    // substitute for it.
    const lockKey = saleDecrementPositionLockKey(owner, line.productId, line.productVariantId);
    const lockToken = await this.syncLock.acquire(lockKey, SALE_DECREMENT_POSITION_LOCK_TTL_MS);
    if (lockToken === null) {
      await this.decrements.recordUnclaimed(ref, {
        status: 'retryable',
        reason: 'position-contended',
        detail: `another sale decrement for this product master's stock position is in flight`,
      });
      return this.reportRow(line, await this.decrements.findByKey(ref.idempotencyKey), false);
    }

    try {
      const existing = await this.decrements.findByKey(ref.idempotencyKey);
      if (existing !== null && existing.status !== 'retryable') {
        // A replay of a line that already succeeded re-runs the consume, so a
        // consume that failed on a previous run heals HERE — the only place it
        // can, which is why a failure below is reported rather than swallowed.
        if (!(await this.consumeHoldIfSettled(input.orderId, line.orderLineId, existing))) {
          holdCloseFailedLineIds.push(line.orderLineId);
        }
        return await this.reportExisting(line, existing, adapters, resolution.position);
      }

      const adapter = await this.resolveAdapter(owner, adapters);
      if ('error' in adapter) {
        await this.decrements.recordUnclaimed(ref, {
          status: 'retryable',
          reason: 'adapter-unresolved',
          detail: adapter.error,
        });
        return this.reportRow(line, await this.decrements.findByKey(ref.idempotencyKey), false);
      }

      const claimed = await this.decrements.claim(ref);
      if (claimed === null) {
        // A peer claimed it between our read and this statement.
        const winner = await this.decrements.findByKey(ref.idempotencyKey);
        if (winner === null) {
          throw new Error(`Sale decrement claim vanished: ${ref.idempotencyKey}`);
        }
        if (!(await this.consumeHoldIfSettled(input.orderId, line.orderLineId, winner))) {
          holdCloseFailedLineIds.push(line.orderLineId);
        }
        return await this.reportExisting(line, winner, adapters, resolution.position);
      }

      const settlement = await this.write(
        adapter.adapter,
        line,
        ref.idempotencyKey,
        resolution.availableQuantity
      );
      await this.decrements.settle(claimed.id, settlement);

      if (settlement.status === 'applied' || settlement.status === 'deduplicated') {
        // Consume BEFORE the mirror write (#3480): the propagation `setInventory`
        // enqueues then reads an ATP where the hold is already gone and the master
        // is already lower, so the sale is never subtracted twice — not even for
        // the moment between the two writes.
        if (!(await this.consumeHold(input.orderId, line.orderLineId))) {
          holdCloseFailedLineIds.push(line.orderLineId);
        }
        await this.mirrorResult(resolution.position, owner, settlement.resultingQuantity, line);
      } else if (settlement.status === 'in_doubt') {
        await this.refreshFromMaster(adapter.adapter, resolution.position, owner, line);
      }

      if (settlement.status !== 'applied' && settlement.status !== 'deduplicated') {
        this.logger.error(
          `Sale decrement did not lower the product master's stock: orderId=${input.orderId} ` +
            `workId=${input.workId} line=${line.orderLineId} owner=${owner} ` +
            `status=${settlement.status} reason=${settlement.reason ?? 'unknown'}`
        );
      }

      return {
        orderLineId: line.orderLineId,
        status: settlement.status,
        reason: settlement.reason,
        ownerConnectionId: owner,
        attempted: true,
      };
    } finally {
      await this.syncLock.release(lockKey, lockToken);
    }
  }

  /**
   * Cross the boundary, and classify whatever comes back.
   *
   * Never throws: every answer — including an unrecognised one — becomes a
   * settlement, so the claim is always settled.
   */
  private async write(
    adapter: InventoryMasterPort,
    line: SaleDecrementLineInput,
    idempotencyKey: string,
    availableBefore: number
  ): Promise<SaleDecrementSettlement> {
    let result: InventoryAdjustmentResult;
    try {
      result = await adapter.adjustInventory({
        productId: line.productId,
        variantId: line.productVariantId ?? undefined,
        quantity: -line.quantity,
        reason: 'order_sale',
        idempotencyKey,
      });
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim() !== ''
          ? error.message
          : 'the product master refused the adjustment without a message';
      if (error instanceof MasterProductNotFoundError) {
        // The platform reports the product absent — there is nothing to lower,
        // so this is a refusal, not an unknown.
        return this.failed('blocked', 'master-product-not-found', detail);
      }
      return this.failed('in_doubt', 'master-error', detail);
    }

    // Absent means "not reported", which the port contract says a caller MUST
    // read as `unsupported` — never as a honoured dedupe.
    const outcome = result.adjustmentOutcome;
    const idempotencyUnsupported = (outcome?.idempotency ?? 'unsupported') === 'unsupported';
    const disposition = outcome?.disposition ?? 'applied';

    if (disposition !== 'applied' && disposition !== 'deduplicated') {
      return {
        ...this.failed(
          'in_doubt',
          'unrecognised-disposition',
          `the product master reported an unrecognised disposition "${String(disposition)}"`
        ),
        idempotencyUnsupported,
      };
    }

    if (idempotencyUnsupported) {
      // Not a failure — the write landed. But a MANUAL retry against this master
      // would double-apply, and only the adapter's admission reveals that.
      this.logger.warn(
        `Sale decrement ${idempotencyKey}: the product master does not support ` +
          'idempotency keys; the Postgres claim is the only duplicate guard'
      );
    }

    // The master clamps at 0 rather than refusing, so selling more than OL had
    // mirrored is the only way to see a clamp from here. It is an INFERENCE from a
    // mirror that may be stale, and the write itself succeeded, so it is logged
    // and persisted on the row but never raised as an operator-facing block.
    const clamped = line.quantity > availableBefore;
    if (clamped) {
      this.logger.warn(
        `Sale decrement for line ${line.orderLineId} exceeded the stock OpenLinker had mirrored ` +
          `(${String(line.quantity)} > ${String(availableBefore)}); the master's own answer stands`
      );
    }

    return {
      status: disposition,
      reason: null,
      detail: null,
      clamped,
      idempotencyUnsupported,
      resultingQuantity: Number.isFinite(result.available) ? result.available : null,
    };
  }

  private failed(
    status: 'blocked' | 'in_doubt',
    reason: SaleDecrementSettlement['reason'],
    detail: string
  ): SaleDecrementSettlement {
    return {
      status,
      reason,
      detail,
      clamped: false,
      idempotencyUnsupported: false,
      resultingQuantity: null,
    };
  }

  /**
   * Report a row this run did not claim. A row still `pending` is a claim whose
   * process died mid-call: it becomes `in_doubt`, is never re-sent, and the
   * master's stock is re-read so the marketplaces at least show its real number.
   */
  private async reportExisting(
    line: SaleDecrementLineInput,
    existing: InventorySaleDecrement,
    adapters: Map<string, Promise<AdapterResolution>>,
    position: InventoryOwnerPosition
  ): Promise<SaleDecrementLineOutcome> {
    if (existing.status !== 'pending') {
      return this.reportRow(line, existing, false);
    }

    const marked = await this.decrements.markInterrupted(existing.idempotencyKey);
    if (marked && existing.ownerConnectionId !== null) {
      this.logger.error(
        `Sale decrement ${existing.idempotencyKey} was interrupted mid-call; ` +
          'marking it in doubt instead of sending it again'
      );
      const adapter = await this.resolveAdapter(existing.ownerConnectionId, adapters);
      if ('adapter' in adapter) {
        await this.refreshFromMaster(adapter.adapter, position, existing.ownerConnectionId, line);
      }
    }
    return this.reportRow(line, await this.decrements.findByKey(existing.idempotencyKey), false);
  }

  private reportRow(
    line: SaleDecrementLineInput,
    row: InventorySaleDecrement | null,
    attempted: boolean
  ): SaleDecrementLineOutcome {
    if (row === null) {
      throw new Error(`Sale decrement row missing after write: line=${line.orderLineId}`);
    }
    return {
      orderLineId: line.orderLineId,
      status: row.status,
      reason: row.reason,
      ownerConnectionId: row.ownerConnectionId,
      attempted,
    };
  }

  /** Write the master's answer to the mirror; `setInventory` enqueues propagation. */
  private async mirrorResult(
    position: InventoryOwnerPosition,
    owner: string,
    resultingQuantity: number | null,
    line: SaleDecrementLineInput
  ): Promise<void> {
    if (resultingQuantity === null) {
      this.logger.warn(
        `Sale decrement for line ${line.orderLineId} applied, but the product master ` +
          'reported no quantity; the next stock sync will publish it'
      );
      return;
    }
    // `reserved` is the pre-decrement snapshot, alongside a fresh `available`
    // from the settlement — a master that moves its own reserved count as
    // part of the sale can therefore leave the mirror holding one fresh and
    // one stale number. Bounded: #2321 never subtracts `reservedQuantity`
    // from ATP, so the consequence is display-only, unlike `refreshFromMaster`
    // below (used on the `in_doubt` path), which re-reads both from one call.
    await this.writeMirror(position, owner, resultingQuantity, position.reservedQuantity, line);
  }

  /**
   * Best-effort re-read after an unknown outcome. Whatever the write did, the
   * marketplaces then show what the master really holds.
   */
  private async refreshFromMaster(
    adapter: InventoryMasterPort,
    position: InventoryOwnerPosition,
    owner: string,
    line: SaleDecrementLineInput
  ): Promise<void> {
    try {
      const entries = await adapter.listInventory(line.productId);
      const entry =
        entries.find((candidate) => candidate.variantId === (line.productVariantId ?? undefined)) ??
        (entries.length === 1 ? entries[0] : undefined);
      if (entry === undefined) {
        this.logger.warn(
          `Could not re-read the product master's stock for line ${line.orderLineId}: ` +
            'no matching variant in its answer'
        );
        return;
      }
      await this.writeMirror(position, owner, entry.available, entry.reserved, line);
    } catch (error) {
      this.logger.warn(
        `Could not re-read the product master's stock for line ${line.orderLineId}: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  private async writeMirror(
    position: InventoryOwnerPosition,
    owner: string,
    availableQuantity: number,
    reservedQuantity: number,
    line: SaleDecrementLineInput
  ): Promise<void> {
    try {
      await this.inventoryService.setInventory(
        new InventoryItem(
          position.inventoryItemId,
          position.productId,
          position.productVariantId,
          availableQuantity,
          reservedQuantity,
          position.locationId,
          new Date(),
          false,
          owner
        ),
        owner
      );
    } catch (error) {
      // The master is already lowered; only the mirror and its propagation are
      // late, and the next stock sync repairs both. Never fail the line for it.
      this.logger.warn(
        `Sale decrement for line ${line.orderLineId} landed, but the stock mirror ` +
          `could not be updated: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Consume the line's hold when its decrement row records a success.
   *
   * @returns `true` when nothing needed consuming, or the consume succeeded;
   *   `false` only when a consume was attempted and failed — the caller must
   *   report that on the run's result rather than swallow it (#3491 review).
   */
  private async consumeHoldIfSettled(
    orderId: string,
    orderLineId: string,
    row: InventorySaleDecrement | null
  ): Promise<boolean> {
    if (row === null) return true;
    if (row.status === 'applied' || row.status === 'deduplicated' || row.status === 'skipped') {
      return this.consumeHold(orderId, orderLineId);
    }
    return true;
  }

  /**
   * Close the line's advisory hold as `consumed` (#3480).
   *
   * The routed order's hold is stamped `published`, so it subtracts from what
   * marketplaces are told from the moment the order is routed. Once the master
   * itself is lower, the hold must stop counting, or the sale is subtracted
   * twice — and the shortfall reconciler (#2349) opens a false episode on every
   * low-stock item. A failed decrement never reaches here, so its hold keeps the
   * stock reduced while the retry runs.
   *
   * Never throws and never undoes the decrement, which is already durable —
   * but a failure is not swallowed either. It is REPORTED as `false`, and the
   * caller adds the line to `holdCloseFailedLineIds`, which the handler turns
   * into a retryable throw. The next run's replay path re-enters this same
   * method against the now-settled row (`releaseHeld` is guarded on `held`,
   * so a retry is idempotent) — that replay is the only path that can heal a
   * failed close, so leaving this failure unreported would leave a `published`
   * reservation permanently subtracting from ATP for a sale the master already
   * lowered.
   */
  private async consumeHold(orderId: string, orderLineId: string): Promise<boolean> {
    try {
      const result = await this.reservations.closeForOrder({
        orderRecordId: orderId,
        terminalStatus: 'consumed',
        orderLineIds: [orderLineId],
      });
      if (result.failed > 0) {
        this.logger.error(
          `Could not close the hold for line ${orderLineId} of order ${orderId} after ` +
            'its sale decrement; retrying'
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(
        `Could not close the hold for line ${orderLineId} of order ${orderId} after its ` +
          `sale decrement: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  private resolveAdapter(
    owner: string,
    adapters: Map<string, Promise<AdapterResolution>>
  ): Promise<AdapterResolution> {
    let pending = adapters.get(owner);
    if (pending === undefined) {
      pending = this.integrations
        .getCapabilityAdapter<InventoryMasterPort>(owner, 'InventoryMaster')
        .then(
          (adapter): AdapterResolution => ({ adapter }),
          (error: unknown): AdapterResolution => ({
            error:
              `the product master's stock connection could not be built — check its ` +
              `credentials and status (${error instanceof Error ? error.message : String(error)})`,
          })
        );
      adapters.set(owner, pending);
    }
    return pending;
  }

  private lineRef(
    input: DecrementForWorkInput,
    line: SaleDecrementLineInput,
    ownerConnectionId: string | null,
    idempotencyKey: string
  ): SaleDecrementLineRef {
    return {
      idempotencyKey,
      orderId: input.orderId,
      workId: input.workId,
      orderLineId: line.orderLineId,
      productId: line.productId,
      productVariantId: line.productVariantId,
      ownerConnectionId,
      quantity: line.quantity,
    };
  }
}
