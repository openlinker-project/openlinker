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
 * 7. **Mirror + propagate** — the master's new quantity is written to
 *    `inventory_items` through `setInventory`, which enqueues
 *    `inventory.propagateToMarketplaces`.
 *
 * Any throw from the write is `in_doubt`, paired with a best-effort re-read of
 * the master's stock so the marketplaces show its real number whichever way the
 * write went. See `inventory-sale-decrement.types.ts` for why an unknown outcome
 * is never retried automatically.
 *
 * @module libs/core/src/inventory/application/services
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { MasterProductNotFoundError } from '@openlinker/core/products';
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
} from '../../domain/types/inventory-sale-decrement.types';
import {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
} from '../../inventory.tokens';
import { IInventoryService } from './inventory.service.interface';
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
    private readonly integrations: IIntegrationsService
  ) {}

  async decrementForWork(input: DecrementForWorkInput): Promise<DecrementForWorkResult> {
    const productIds = [...new Set(input.lines.map((line) => line.productId))];
    const positions = await this.inventoryRepository.findLiveOwnerPositions(productIds);

    // One adapter per owner per run: a two-master basket builds two, never one
    // per line.
    const adapters = new Map<string, Promise<AdapterResolution>>();
    const outcomes: SaleDecrementLineOutcome[] = [];

    for (const line of input.lines) {
      if (line.quantity <= 0) continue;
      outcomes.push(await this.decrementLine(input, line, positions, adapters));
    }

    const rows = await this.decrements.findByOrderId(input.orderId);

    return {
      lines: outcomes,
      retryableLineIds: outcomes
        .filter((outcome) => outcome.status === 'retryable')
        .map((outcome) => outcome.orderLineId),
      attention: deriveSaleDecrementAttention(rows),
    };
  }

  private async decrementLine(
    input: DecrementForWorkInput,
    line: SaleDecrementLineInput,
    positions: readonly InventoryOwnerPosition[],
    adapters: Map<string, Promise<AdapterResolution>>
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
      return this.reportRow(line, await this.decrements.findByKey(ref.idempotencyKey), false);
    }

    const existing = await this.decrements.findByKey(ref.idempotencyKey);
    if (existing !== null && existing.status !== 'retryable') {
      return this.reportExisting(line, existing, adapters, resolution.position);
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
      return this.reportExisting(line, winner, adapters, resolution.position);
    }

    const settlement = await this.write(
      adapter.adapter,
      line,
      ref.idempotencyKey,
      resolution.availableQuantity
    );
    await this.decrements.settle(claimed.id, settlement);

    if (settlement.status === 'applied' || settlement.status === 'deduplicated') {
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

    return {
      status: disposition,
      reason: null,
      detail: null,
      // The master clamps at 0 rather than refusing, so selling more than OL had
      // mirrored is the only way to see a clamp from here.
      clamped: line.quantity > availableBefore,
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
