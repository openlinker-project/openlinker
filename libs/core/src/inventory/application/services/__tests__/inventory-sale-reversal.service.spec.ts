/**
 * InventorySaleReversalService — spec (#3479)
 *
 * Backed by the same faithful in-memory claim semantics as
 * `inventory-sale-decrement.service.spec.ts` — insert-or-reclaim-retryable,
 * never overwrite a settled row — so the replay case below exercises the real
 * guarantee. The atomicity of the claim against a real database is the
 * int-spec's job.
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { MasterProductNotFoundError } from '@openlinker/core/products';

import { InventorySaleDecrement } from '../../../domain/entities/inventory-sale-decrement.entity';
import type { InventoryItem } from '../../../domain/entities/inventory-item.entity';
import type {
  InventoryAdjustmentResult,
  InventoryMasterPort,
} from '../../../domain/ports/inventory-master.port';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import type {
  InventorySaleDecrementRepositoryPort,
  SaleDecrementLineRef,
  SaleDecrementSettlement,
  SaleDecrementUnclaimedOutcome,
} from '../../../domain/ports/inventory-sale-decrement-repository.port';
import type { InventoryOwnerPosition } from '../../../domain/types/inventory.types';
import type { IInventoryService } from '../inventory.service.interface';
import { InventorySaleReversalService } from '../inventory-sale-reversal.service';

/** A faithful in-memory implementation of the port's claim semantics. */
/* eslint-disable @typescript-eslint/require-await -- an in-memory fake of an async port: the bodies are synchronous by design */
class InMemorySaleDecrementRepository implements InventorySaleDecrementRepositoryPort {
  readonly rows = new Map<string, InventorySaleDecrement>();
  private sequence = 0;

  /** Seed a pre-existing `order_sale` decrement row directly (bypassing claim/settle). */
  seed(row: {
    idempotencyKey: string;
    orderId: string;
    workId: string;
    orderLineId: string;
    productId: string;
    productVariantId: string | null;
    ownerConnectionId: string | null;
    quantity: number;
    status: InventorySaleDecrement['status'];
  }): void {
    this.sequence += 1;
    this.rows.set(
      row.idempotencyKey,
      new InventorySaleDecrement(
        `row-${String(this.sequence)}`,
        row.idempotencyKey,
        row.orderId,
        row.workId,
        row.orderLineId,
        row.productId,
        row.productVariantId,
        row.ownerConnectionId,
        row.quantity,
        row.status,
        null,
        null,
        false,
        false,
        null,
        new Date(),
        new Date()
      )
    );
  }

  async claim(line: SaleDecrementLineRef): Promise<InventorySaleDecrement | null> {
    const existing = this.rows.get(line.idempotencyKey);
    if (existing !== undefined && existing.status !== 'retryable') return null;
    const row = this.build(line, existing?.id, 'pending', null, null);
    this.rows.set(line.idempotencyKey, row);
    return row;
  }

  async recordUnclaimed(
    line: SaleDecrementLineRef,
    outcome: SaleDecrementUnclaimedOutcome
  ): Promise<void> {
    const existing = this.rows.get(line.idempotencyKey);
    if (existing !== undefined && existing.status !== 'retryable') return;
    this.rows.set(
      line.idempotencyKey,
      this.build(line, existing?.id, outcome.status, outcome.reason, outcome.detail)
    );
  }

  async settle(id: string, settlement: SaleDecrementSettlement): Promise<void> {
    for (const [key, row] of this.rows) {
      if (row.id !== id) continue;
      this.rows.set(
        key,
        new InventorySaleDecrement(
          row.id,
          row.idempotencyKey,
          row.orderId,
          row.workId,
          row.orderLineId,
          row.productId,
          row.productVariantId,
          row.ownerConnectionId,
          row.quantity,
          settlement.status,
          settlement.reason,
          settlement.detail,
          settlement.clamped,
          settlement.idempotencyUnsupported,
          settlement.resultingQuantity,
          row.createdAt,
          new Date()
        )
      );
    }
  }

  async markInterrupted(idempotencyKey: string): Promise<boolean> {
    const row = this.rows.get(idempotencyKey);
    if (row === undefined || row.status !== 'pending') return false;
    await this.settle(row.id, {
      status: 'in_doubt',
      reason: 'interrupted',
      detail: 'interrupted',
      clamped: false,
      idempotencyUnsupported: false,
      resultingQuantity: null,
    });
    return true;
  }

  async findByKey(idempotencyKey: string): Promise<InventorySaleDecrement | null> {
    return this.rows.get(idempotencyKey) ?? null;
  }

  async findByOrderId(orderId: string): Promise<InventorySaleDecrement[]> {
    return [...this.rows.values()].filter((row) => row.orderId === orderId);
  }

  private build(
    line: SaleDecrementLineRef,
    id: string | undefined,
    status: InventorySaleDecrement['status'],
    reason: InventorySaleDecrement['reason'],
    detail: string | null
  ): InventorySaleDecrement {
    this.sequence += 1;
    return new InventorySaleDecrement(
      id ?? `row-${String(this.sequence)}`,
      line.idempotencyKey,
      line.orderId,
      line.workId,
      line.orderLineId,
      line.productId,
      line.productVariantId,
      line.ownerConnectionId,
      line.quantity,
      status,
      reason,
      detail,
      false,
      false,
      null,
      new Date(),
      new Date()
    );
  }
}
/* eslint-enable @typescript-eslint/require-await -- end of the in-memory fake */

const position = (overrides: Partial<InventoryOwnerPosition> = {}): InventoryOwnerPosition => ({
  inventoryItemId: 'inv-1',
  productId: 'ol_product_1',
  productVariantId: 'ol_variant_1',
  locationId: null,
  sourceConnectionId: 'conn-shop',
  availableQuantity: 4,
  reservedQuantity: 0,
  ...overrides,
});

const adjusted = (available: number, outcome?: InventoryAdjustmentResult['adjustmentOutcome']) =>
  ({
    id: 'inv-1',
    productId: 'ol_product_1',
    variantId: 'ol_variant_1',
    quantity: available,
    reserved: 0,
    available,
    adjustmentOutcome: outcome,
  }) as InventoryAdjustmentResult;

const HONOURED = { disposition: 'applied', idempotency: 'honoured', appliedAt: null } as const;

describe('InventorySaleReversalService', () => {
  let repository: InMemorySaleDecrementRepository;
  let positions: InventoryOwnerPosition[];
  let adapters: Map<string, jest.Mocked<Pick<InventoryMasterPort, 'adjustInventory' | 'listInventory'>>>;
  let integrations: { getCapabilityAdapter: jest.Mock };
  let inventoryService: { setInventory: jest.Mock };
  let service: InventorySaleReversalService;

  const makeAdapter = () => ({
    adjustInventory: jest.fn().mockResolvedValue(adjusted(5, HONOURED)),
    listInventory: jest.fn().mockResolvedValue([]),
  });

  /** Seed the applied `order_sale` decrement row #3453 would have written. */
  function seedAppliedDecrement(overrides: {
    orderLineId?: string;
    ownerConnectionId?: string;
    quantity?: number;
    status?: InventorySaleDecrement['status'];
  } = {}): void {
    const orderLineId = overrides.orderLineId ?? 'line-1';
    const ownerConnectionId = overrides.ownerConnectionId ?? 'conn-shop';
    repository.seed({
      idempotencyKey: `sale:${ownerConnectionId}:w-1:${orderLineId}`,
      orderId: 'ol_order_1',
      workId: 'w-1',
      orderLineId,
      productId: 'ol_product_1',
      productVariantId: 'ol_variant_1',
      ownerConnectionId,
      quantity: overrides.quantity ?? 1,
      status: overrides.status ?? 'applied',
    });
  }

  beforeEach(() => {
    repository = new InMemorySaleDecrementRepository();
    positions = [position()];
    adapters = new Map([['conn-shop', makeAdapter()]]);
    integrations = {
      getCapabilityAdapter: jest.fn((connectionId: string) => {
        const adapter = adapters.get(connectionId);
        return adapter === undefined
          ? Promise.reject(new Error(`no adapter for ${connectionId}`))
          : Promise.resolve(adapter);
      }),
    };
    inventoryService = { setInventory: jest.fn().mockResolvedValue(undefined) };

    service = new InventorySaleReversalService(
      {
        findLiveOwnerPositions: jest.fn(() => Promise.resolve(positions)),
      } as unknown as InventoryRepositoryPort,
      repository,
      inventoryService as unknown as IInventoryService,
      integrations as unknown as IIntegrationsService
    );
  });

  const shop = () => adapters.get('conn-shop')!;

  it('should raise the owner master by the sold quantity under the reversal key', async () => {
    seedAppliedDecrement();

    const result = await service.reverseForOrder('ol_order_1');

    expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
    expect(shop().adjustInventory).toHaveBeenCalledWith({
      productId: 'ol_product_1',
      variantId: 'ol_variant_1',
      quantity: 1,
      reason: 'order_sale_reversal',
      idempotencyKey: 'sale-reversal:conn-shop:w-1:line-1',
    });
    expect(result.lines).toEqual([
      {
        orderLineId: 'line-1',
        status: 'applied',
        reason: null,
        ownerConnectionId: 'conn-shop',
        attempted: true,
      },
    ]);
  });

  it('should write the master\'s new quantity to the mirror so propagation runs', async () => {
    seedAppliedDecrement();

    await service.reverseForOrder('ol_order_1');

    expect(inventoryService.setInventory).toHaveBeenCalledTimes(1);
    const [item, sourceConnectionId] = inventoryService.setInventory.mock.calls[0] as [
      InventoryItem,
      string,
    ];
    expect(sourceConnectionId).toBe('conn-shop');
    expect(item).toMatchObject({
      id: 'inv-1',
      productId: 'ol_product_1',
      productVariantId: 'ol_variant_1',
      availableQuantity: 5,
      sourceConnectionId: 'conn-shop',
    });
  });

  it('should do nothing for an order with no applied sale decrement (storefront order)', async () => {
    const result = await service.reverseForOrder('ol_order_1');

    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(result.lines).toEqual([]);
  });

  it('should skip a decrement that never applied — blocked, skipped, retryable or in_doubt', async () => {
    seedAppliedDecrement({ orderLineId: 'line-blocked', status: 'blocked' });
    seedAppliedDecrement({ orderLineId: 'line-skipped', status: 'skipped' });
    seedAppliedDecrement({ orderLineId: 'line-retryable', status: 'retryable' });
    seedAppliedDecrement({ orderLineId: 'line-in-doubt', status: 'in_doubt' });

    const result = await service.reverseForOrder('ol_order_1');

    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(result.lines).toEqual([]);
  });

  it('should not raise the master twice on a replay of the same cancellation', async () => {
    seedAppliedDecrement();

    await service.reverseForOrder('ol_order_1');
    const replay = await service.reverseForOrder('ol_order_1');

    expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
    expect(replay.lines[0]).toMatchObject({ status: 'applied', attempted: false });
  });

  it('should raise each owner for its own lines only in a two-master basket', async () => {
    adapters.set('conn-subiekt', makeAdapter());
    positions = [
      position(),
      position({
        inventoryItemId: 'inv-2',
        productId: 'ol_product_2',
        productVariantId: 'ol_variant_2',
        sourceConnectionId: 'conn-subiekt',
      }),
    ];
    repository.seed({
      idempotencyKey: 'sale:conn-shop:w-1:line-1',
      orderId: 'ol_order_1',
      workId: 'w-1',
      orderLineId: 'line-1',
      productId: 'ol_product_1',
      productVariantId: 'ol_variant_1',
      ownerConnectionId: 'conn-shop',
      quantity: 1,
      status: 'applied',
    });
    repository.seed({
      idempotencyKey: 'sale:conn-subiekt:w-1:line-2',
      orderId: 'ol_order_1',
      workId: 'w-1',
      orderLineId: 'line-2',
      productId: 'ol_product_2',
      productVariantId: 'ol_variant_2',
      ownerConnectionId: 'conn-subiekt',
      quantity: 2,
      status: 'applied',
    });

    await service.reverseForOrder('ol_order_1');

    expect(shop().adjustInventory).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'ol_product_1', quantity: 1 })
    );
    const subiekt = adapters.get('conn-subiekt')!;
    expect(subiekt.adjustInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'ol_product_2',
        quantity: 2,
        idempotencyKey: 'sale-reversal:conn-subiekt:w-1:line-2',
      })
    );
  });

  describe('when the owner adapter cannot be built', () => {
    beforeEach(() => {
      adapters.delete('conn-shop');
    });

    it('should mark the line retryable and cross nothing', async () => {
      seedAppliedDecrement();

      const result = await service.reverseForOrder('ol_order_1');

      expect(result.lines[0]).toMatchObject({ status: 'retryable', reason: 'adapter-unresolved' });
    });

    it('should raise the stock on the retry once the adapter is back', async () => {
      seedAppliedDecrement();
      await service.reverseForOrder('ol_order_1');
      adapters.set('conn-shop', makeAdapter());

      const retry = await service.reverseForOrder('ol_order_1');

      expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
      expect(retry.lines[0]).toMatchObject({ status: 'applied' });
    });
  });

  describe('when the write throws', () => {
    beforeEach(() => {
      seedAppliedDecrement();
      shop().adjustInventory.mockRejectedValue(new Error('PrestaShop answered 500'));
      shop().listInventory.mockResolvedValue([
        { id: 'inv-1', productId: 'ol_product_1', variantId: 'ol_variant_1', quantity: 5, reserved: 0, available: 5 },
      ]);
    });

    it('should mark the line in doubt with the adapter\'s own words', async () => {
      const result = await service.reverseForOrder('ol_order_1');

      expect(result.lines[0]).toMatchObject({ status: 'in_doubt', reason: 'master-error' });
    });

    it('should never send an in-doubt reversal again', async () => {
      await service.reverseForOrder('ol_order_1');
      await service.reverseForOrder('ol_order_1');

      expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
    });
  });

  it('should block rather than doubt when the master reports the product absent', async () => {
    seedAppliedDecrement();
    shop().adjustInventory.mockRejectedValue(new MasterProductNotFoundError('ol_product_1', 'conn-shop'));

    const result = await service.reverseForOrder('ol_order_1');

    expect(result.lines[0]).toMatchObject({
      status: 'blocked',
      reason: 'master-product-not-found',
    });
  });

  it('should never fail the line when the mirror write fails', async () => {
    seedAppliedDecrement();
    inventoryService.setInventory.mockRejectedValue(new Error('db blip'));

    const result = await service.reverseForOrder('ol_order_1');

    expect(result.lines[0]).toMatchObject({ status: 'applied' });
  });
});
