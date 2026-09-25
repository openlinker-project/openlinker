/**
 * Inventory Sale Reversal Service (#3479)
 *
 * #3453 lowers a routed order's product master when it sells, once per work
 * line. Cancelling that order before dispatch has to give the unit back — the
 * exact inverse write, in the same master, or the master's stock is
 * permanently short by every cancelled sale. This service is that inverse.
 *
 * ## Why it reuses #3453's table rather than a new one
 *
 * A decrement and its later reversal are the same line's story told twice, in
 * opposite directions, both against `inventory_sale_decrements`. Reusing the
 * table means reusing the one guarantee that matters — the atomic Postgres
 * claim — without inventing a second ledger with its own race. The reversal's
 * key carries a distinct `sale-reversal:` prefix (never `sale:`), so it claims
 * a SIBLING row rather than colliding with the original decrement's own.
 *
 * ## Order of operations per line, and why
 *
 * 1. **Source row** — read from `findByOrderId`, filtered to `order_sale`
 *    decrements (`sale:` prefix) that actually applied (`applied` /
 *    `deduplicated`). Everything else — never attempted, blocked, skipped as a
 *    storefront order, still `in_doubt` — has nothing on the master to give
 *    back, and reversing an unknown outcome would risk moving stock nobody
 *    confirmed was ever moved.
 * 2. **Existing reversal row** — a replay finds it and reports it without
 *    building an adapter, same as #3453.
 * 3. **Adapter** — built BEFORE claiming, for the same reason: a failure here
 *    provably crossed nothing, so the line is `retryable`.
 * 4. **Claim** — the atomic Postgres claim, written before the boundary.
 * 5. **Write** — `adjustInventory(+n, reason: 'order_sale_reversal')`, keyed
 *    `sale-reversal:{owner}:{workId}:{lineId}`.
 * 6. **Mirror** — the master's new quantity is written back through
 *    `setInventory`, which enqueues `inventory.propagateToMarketplaces` —
 *    every OTHER marketplace this master feeds sees the reversal too, not just
 *    the order's own source connection (whose offer `OfferStockRestoreService`
 *    restores separately, from the master's now-current ATP).
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
import { buildSaleReversalIdempotencyKey } from '../../domain/types/inventory-sale-decrement.types';
import {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
} from '../../inventory.tokens';
import { IInventoryService } from './inventory.service.interface';
import type {
  IInventorySaleReversalService,
  ReverseSaleForOrderResult,
  SaleReversalLineOutcome,
} from './inventory-sale-reversal.service.interface';

/** An owner's adapter, or the reason it could not be built. */
type AdapterResolution = { readonly adapter: InventoryMasterPort } | { readonly error: string };

/** The `order_sale` prefix distinguishing an original decrement key from its reversal. */
const SALE_DECREMENT_KEY_PREFIX = 'sale:';
const APPLIED_STATUSES = new Set(['applied', 'deduplicated']);

@Injectable()
export class InventorySaleReversalService implements IInventorySaleReversalService {
  private readonly logger = new Logger(InventorySaleReversalService.name);

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

  async reverseForOrder(internalOrderId: string): Promise<ReverseSaleForOrderResult> {
    const rows = await this.decrements.findByOrderId(internalOrderId);
    const appliedDecrements = rows.filter(
      (row) =>
        row.idempotencyKey.startsWith(SALE_DECREMENT_KEY_PREFIX) &&
        row.ownerConnectionId !== null &&
        APPLIED_STATUSES.has(row.status)
    );

    if (appliedDecrements.length === 0) {
      return { lines: [] };
    }

    const productIds = [...new Set(appliedDecrements.map((row) => row.productId))];
    const positions = await this.inventoryRepository.findLiveOwnerPositions(productIds);
    const adapters = new Map<string, Promise<AdapterResolution>>();

    const outcomes: SaleReversalLineOutcome[] = [];
    for (const row of appliedDecrements) {
      outcomes.push(await this.reverseLine(row, positions, adapters));
    }
    return { lines: outcomes };
  }

  private async reverseLine(
    row: InventorySaleDecrement,
    positions: readonly InventoryOwnerPosition[],
    adapters: Map<string, Promise<AdapterResolution>>
  ): Promise<SaleReversalLineOutcome> {
    // `appliedDecrements` is filtered to `ownerConnectionId !== null` above.
    const owner = row.ownerConnectionId as string;
    const idempotencyKey = buildSaleReversalIdempotencyKey(owner, row.workId, row.orderLineId);
    const ref = this.lineRef(row, owner, idempotencyKey);

    const existing = await this.decrements.findByKey(idempotencyKey);
    if (existing !== null && existing.status !== 'retryable') {
      return this.report(row, owner, existing, false);
    }

    const adapter = await this.resolveAdapter(owner, adapters);
    if ('error' in adapter) {
      await this.decrements.recordUnclaimed(ref, {
        status: 'retryable',
        reason: 'adapter-unresolved',
        detail: adapter.error,
      });
      return this.report(row, owner, await this.decrements.findByKey(idempotencyKey), false);
    }

    const claimed = await this.decrements.claim(ref);
    if (claimed === null) {
      // A peer claimed it between our read and this statement.
      const winner = await this.decrements.findByKey(idempotencyKey);
      if (winner === null) {
        throw new Error(`Sale reversal claim vanished: ${idempotencyKey}`);
      }
      return this.report(row, owner, winner, false);
    }

    const settlement = await this.write(adapter.adapter, row, idempotencyKey);
    await this.decrements.settle(claimed.id, settlement);

    const position = this.findPosition(positions, owner, row.productId, row.productVariantId);
    if (
      (settlement.status === 'applied' || settlement.status === 'deduplicated') &&
      settlement.resultingQuantity !== null &&
      position !== undefined
    ) {
      await this.writeMirror(position, owner, settlement.resultingQuantity, row);
    } else if (settlement.status === 'in_doubt' && position !== undefined) {
      await this.refreshFromMaster(adapter.adapter, position, owner, row);
    }

    if (settlement.status !== 'applied' && settlement.status !== 'deduplicated') {
      this.logger.error(
        `Sale reversal did not raise the product master's stock: orderId=${row.orderId} ` +
          `workId=${row.workId} line=${row.orderLineId} owner=${owner} ` +
          `status=${settlement.status} reason=${settlement.reason ?? 'unknown'}`
      );
    }

    return {
      orderLineId: row.orderLineId,
      status: settlement.status,
      reason: settlement.reason,
      ownerConnectionId: owner,
      attempted: true,
    };
  }

  /** Never throws: every answer becomes a settlement, so the claim is always settled. */
  private async write(
    adapter: InventoryMasterPort,
    row: InventorySaleDecrement,
    idempotencyKey: string
  ): Promise<SaleDecrementSettlement> {
    let result: InventoryAdjustmentResult;
    try {
      result = await adapter.adjustInventory({
        productId: row.productId,
        variantId: row.productVariantId ?? undefined,
        quantity: row.quantity,
        reason: 'order_sale_reversal',
        idempotencyKey,
      });
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim() !== ''
          ? error.message
          : 'the product master refused the adjustment without a message';
      if (error instanceof MasterProductNotFoundError) {
        return this.failed('blocked', 'master-product-not-found', detail);
      }
      return this.failed('in_doubt', 'master-error', detail);
    }

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
      this.logger.warn(
        `Sale reversal ${idempotencyKey}: the product master does not support ` +
          'idempotency keys; the Postgres claim is the only duplicate guard'
      );
    }

    return {
      status: disposition,
      reason: null,
      detail: null,
      clamped: false,
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

  private report(
    row: InventorySaleDecrement,
    owner: string,
    existing: InventorySaleDecrement | null,
    attempted: boolean
  ): SaleReversalLineOutcome {
    if (existing === null) {
      throw new Error(`Sale reversal row missing after write: line=${row.orderLineId}`);
    }
    return {
      orderLineId: row.orderLineId,
      status: existing.status,
      reason: existing.reason,
      ownerConnectionId: owner,
      attempted,
    };
  }

  private findPosition(
    positions: readonly InventoryOwnerPosition[],
    owner: string,
    productId: string,
    productVariantId: string | null
  ): InventoryOwnerPosition | undefined {
    const forOwner = positions.filter(
      (position) => position.productId === productId && position.sourceConnectionId === owner
    );
    return (
      forOwner.find((position) => position.productVariantId === productVariantId) ??
      forOwner.find((position) => position.productVariantId === null) ??
      forOwner[0]
    );
  }

  /**
   * Best-effort re-read after an unknown outcome — same rationale as #3453's
   * own `refreshFromMaster`.
   */
  private async refreshFromMaster(
    adapter: InventoryMasterPort,
    position: InventoryOwnerPosition,
    owner: string,
    row: InventorySaleDecrement
  ): Promise<void> {
    try {
      const entries = await adapter.listInventory(row.productId);
      const entry =
        entries.find((candidate) => candidate.variantId === (row.productVariantId ?? undefined)) ??
        (entries.length === 1 ? entries[0] : undefined);
      if (entry === undefined) {
        this.logger.warn(
          `Could not re-read the product master's stock for reversed line ${row.orderLineId}: ` +
            'no matching variant in its answer'
        );
        return;
      }
      await this.mirror(position, owner, entry.available, entry.reserved, row);
    } catch (error) {
      this.logger.warn(
        `Could not re-read the product master's stock for reversed line ${row.orderLineId}: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  private async writeMirror(
    position: InventoryOwnerPosition,
    owner: string,
    resultingQuantity: number,
    row: InventorySaleDecrement
  ): Promise<void> {
    await this.mirror(position, owner, resultingQuantity, position.reservedQuantity, row);
  }

  private async mirror(
    position: InventoryOwnerPosition,
    owner: string,
    availableQuantity: number,
    reservedQuantity: number,
    row: InventorySaleDecrement
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
      // The master is already raised; only the mirror and its propagation are
      // late, and the next stock sync repairs both. Never fail the line for it.
      this.logger.warn(
        `Sale reversal for line ${row.orderLineId} landed, but the stock mirror could not ` +
          `be updated: ${error instanceof Error ? error.message : String(error)}`
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
    row: InventorySaleDecrement,
    ownerConnectionId: string,
    idempotencyKey: string
  ): SaleDecrementLineRef {
    return {
      idempotencyKey,
      orderId: row.orderId,
      workId: row.workId,
      orderLineId: row.orderLineId,
      productId: row.productId,
      productVariantId: row.productVariantId,
      ownerConnectionId,
      quantity: row.quantity,
    };
  }
}
