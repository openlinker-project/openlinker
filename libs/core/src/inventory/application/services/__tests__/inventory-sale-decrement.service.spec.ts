/**
 * InventorySaleDecrementService — spec (#3453)
 *
 * Backed by an in-memory repository that implements the claim semantics
 * faithfully (insert-or-reclaim-retryable, never overwrite a settled row), so
 * the replay and crash cases below exercise the real guarantee rather than a
 * mock's return value. The atomicity of that claim against a real database is
 * the int-spec's job (`inventory-sale-decrement.int-spec.ts`).
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
import { InventorySaleDecrementService } from '../inventory-sale-decrement.service';
import type { DecrementForWorkInput } from '../inventory-sale-decrement.service.interface';

/** A faithful in-memory implementation of the port's claim semantics. */
/* eslint-disable @typescript-eslint/require-await -- an in-memory fake of an async port: the bodies are synchronous by design */
class InMemorySaleDecrementRepository implements InventorySaleDecrementRepositoryPort {
  readonly rows = new Map<string, InventorySaleDecrement>();
  private sequence = 0;

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
  availableQuantity: 5,
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

describe('InventorySaleDecrementService', () => {
  let repository: InMemorySaleDecrementRepository;
  let positions: InventoryOwnerPosition[];
  let adapters: Map<string, jest.Mocked<Pick<InventoryMasterPort, 'adjustInventory' | 'listInventory'>>>;
  let integrations: { getCapabilityAdapter: jest.Mock };
  let inventoryService: { setInventory: jest.Mock };
  let service: InventorySaleDecrementService;

  const makeAdapter = () => ({
    adjustInventory: jest.fn().mockResolvedValue(adjusted(4, HONOURED)),
    listInventory: jest.fn().mockResolvedValue([]),
  });

  const input = (overrides: Partial<DecrementForWorkInput> = {}): DecrementForWorkInput => ({
    orderId: 'ol_order_1',
    workId: 'w-1',
    orderSourceConnectionId: 'conn-allegro',
    locationId: 'loc-main',
    lines: [
      {
        orderLineId: 'line-1',
        productId: 'ol_product_1',
        productVariantId: 'ol_variant_1',
        quantity: 1,
      },
    ],
    ...overrides,
  });

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

    service = new InventorySaleDecrementService(
      {
        findLiveOwnerPositions: jest.fn(() => Promise.resolve(positions)),
      } as unknown as InventoryRepositoryPort,
      repository,
      inventoryService as unknown as IInventoryService,
      integrations as unknown as IIntegrationsService
    );
  });

  const shop = () => adapters.get('conn-shop')!;

  it('should lower the owner master by the sold quantity under the per-owner key', async () => {
    const result = await service.decrementForWork(input());

    expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
    expect(shop().adjustInventory).toHaveBeenCalledWith({
      productId: 'ol_product_1',
      variantId: 'ol_variant_1',
      quantity: -1,
      reason: 'order_sale',
      idempotencyKey: 'sale:conn-shop:w-1:line-1',
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
    expect(result.attention).toEqual({ kind: 'none' });
  });

  // OL's location id is not the adapter's: the Subiekt adapter reads it as a magazynId.
  it('should never pass the OL location id to the adapter', async () => {
    await service.decrementForWork(input());

    expect(shop().adjustInventory.mock.calls[0][0]).not.toHaveProperty('locationId');
  });

  it('should write the master\'s new quantity to the mirror so propagation runs', async () => {
    await service.decrementForWork(input());

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
      availableQuantity: 4,
      sourceConnectionId: 'conn-shop',
      isStale: false,
    });
  });

  it('should not decrement twice on a replay of the same work', async () => {
    await service.decrementForWork(input());
    const replay = await service.decrementForWork(input());

    expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
    expect(replay.lines[0]).toMatchObject({ status: 'applied', attempted: false });
  });

  // The Postgres claim is the guarantee, not the adapter's key.
  it('should not decrement twice when the adapter reports idempotency unsupported', async () => {
    shop().adjustInventory.mockResolvedValue(
      adjusted(4, { disposition: 'applied', idempotency: 'unsupported', appliedAt: null })
    );

    await service.decrementForWork(input());
    await service.decrementForWork(input());
    await service.decrementForWork(input());

    expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
    expect(repository.rows.get('sale:conn-shop:w-1:line-1')).toMatchObject({
      status: 'applied',
      idempotencyUnsupported: true,
    });
  });

  it('should treat an adapter that reports no outcome as unsupported, not as a dedupe', async () => {
    shop().adjustInventory.mockResolvedValue(adjusted(4, undefined));

    await service.decrementForWork(input());

    expect(repository.rows.get('sale:conn-shop:w-1:line-1')).toMatchObject({
      status: 'applied',
      idempotencyUnsupported: true,
    });
  });

  it('should record a deduplicated answer as a success', async () => {
    shop().adjustInventory.mockResolvedValue(
      adjusted(4, { disposition: 'deduplicated', idempotency: 'honoured', appliedAt: null })
    );

    const result = await service.decrementForWork(input());

    expect(result.lines[0]).toMatchObject({ status: 'deduplicated' });
    expect(result.attention).toEqual({ kind: 'none' });
  });

  it('should skip and persist the reason when the order came from the line\'s own master', async () => {
    const result = await service.decrementForWork(
      input({ orderSourceConnectionId: 'conn-shop' })
    );

    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(shop().adjustInventory).not.toHaveBeenCalled();
    expect(result.lines[0]).toMatchObject({ status: 'skipped', reason: 'source-is-owner' });
    expect(repository.rows.get('sale:conn-shop:w-1:line-1')).toMatchObject({
      status: 'skipped',
      reason: 'source-is-owner',
    });
    expect(result.attention).toEqual({ kind: 'none' });
  });

  it('should lower each owner for its own lines only in a two-master basket', async () => {
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

    await service.decrementForWork(
      input({
        lines: [
          { orderLineId: 'line-1', productId: 'ol_product_1', productVariantId: 'ol_variant_1', quantity: 1 },
          { orderLineId: 'line-2', productId: 'ol_product_2', productVariantId: 'ol_variant_2', quantity: 2 },
        ],
      })
    );

    expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
    expect(shop().adjustInventory).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'ol_product_1', quantity: -1 })
    );
    const subiekt = adapters.get('conn-subiekt')!;
    expect(subiekt.adjustInventory).toHaveBeenCalledTimes(1);
    expect(subiekt.adjustInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'ol_product_2',
        quantity: -2,
        idempotencyKey: 'sale:conn-subiekt:w-1:line-2',
      })
    );
  });

  it('should block a line with no live position without reaching any adapter', async () => {
    positions = [];

    const result = await service.decrementForWork(input());

    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(result.lines[0]).toMatchObject({ status: 'blocked', reason: 'no-position' });
    expect(repository.rows.get('sale:unresolved:w-1:line-1')).toBeDefined();
    expect(result.attention).toMatchObject({ kind: 'blocked' });
  });

  it('should block a line whose stock has no known owner', async () => {
    positions = [position({ sourceConnectionId: 'legacy' })];

    const result = await service.decrementForWork(input());

    expect(result.lines[0]).toMatchObject({ status: 'blocked', reason: 'unattributed-owner' });
  });

  describe('when the owner adapter cannot be built', () => {
    beforeEach(() => {
      adapters.delete('conn-shop');
    });

    it('should leave the line retryable and cross nothing', async () => {
      const result = await service.decrementForWork(input());

      expect(result.retryableLineIds).toEqual(['line-1']);
      expect(result.lines[0]).toMatchObject({ status: 'retryable', reason: 'adapter-unresolved' });
      expect(result.attention).toMatchObject({ kind: 'blocked' });
    });

    it('should lower the stock on the retry once the adapter is back', async () => {
      await service.decrementForWork(input());
      adapters.set('conn-shop', makeAdapter());

      const retry = await service.decrementForWork(input());

      expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
      expect(retry.retryableLineIds).toEqual([]);
      expect(retry.lines[0]).toMatchObject({ status: 'applied' });
      expect(retry.attention).toEqual({ kind: 'none' });
    });
  });

  describe('when the write throws', () => {
    beforeEach(() => {
      shop().adjustInventory.mockRejectedValue(new Error('PrestaShop answered 500'));
      shop().listInventory.mockResolvedValue([
        { id: 'inv-1', productId: 'ol_product_1', variantId: 'ol_variant_1', quantity: 5, reserved: 0, available: 5 },
      ]);
    });

    it('should mark the line in doubt with the adapter\'s own words', async () => {
      const result = await service.decrementForWork(input());

      expect(result.lines[0]).toMatchObject({ status: 'in_doubt', reason: 'master-error' });
      expect(repository.rows.get('sale:conn-shop:w-1:line-1')).toMatchObject({
        detail: 'PrestaShop answered 500',
      });
      expect(result.retryableLineIds).toEqual([]);
      expect(result.attention).toMatchObject({ kind: 'blocked' });
    });

    it('should re-read the master\'s stock so the marketplaces show its real number', async () => {
      await service.decrementForWork(input());

      expect(shop().listInventory).toHaveBeenCalledWith('ol_product_1');
      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({ availableQuantity: 5 }),
        'conn-shop'
      );
    });

    it('should never send an in-doubt decrement again', async () => {
      await service.decrementForWork(input());
      await service.decrementForWork(input());

      expect(shop().adjustInventory).toHaveBeenCalledTimes(1);
    });
  });

  it('should block rather than doubt when the master reports the product absent', async () => {
    shop().adjustInventory.mockRejectedValue(new MasterProductNotFoundError('ol_product_1', 'conn-shop'));

    const result = await service.decrementForWork(input());

    expect(result.lines[0]).toMatchObject({
      status: 'blocked',
      reason: 'master-product-not-found',
    });
  });

  it('should mark an unrecognised disposition in doubt', async () => {
    shop().adjustInventory.mockResolvedValue(
      adjusted(4, { disposition: 'queued', idempotency: 'honoured', appliedAt: null } as never)
    );

    const result = await service.decrementForWork(input());

    expect(result.lines[0]).toMatchObject({
      status: 'in_doubt',
      reason: 'unrecognised-disposition',
    });
  });

  // A previous run claimed the line and died before settling it.
  it('should mark a claim left pending as in doubt and never re-send it', async () => {
    await repository.claim({
      idempotencyKey: 'sale:conn-shop:w-1:line-1',
      orderId: 'ol_order_1',
      workId: 'w-1',
      orderLineId: 'line-1',
      productId: 'ol_product_1',
      productVariantId: 'ol_variant_1',
      ownerConnectionId: 'conn-shop',
      quantity: 1,
    });

    const result = await service.decrementForWork(input());

    expect(shop().adjustInventory).not.toHaveBeenCalled();
    expect(shop().listInventory).toHaveBeenCalledWith('ol_product_1');
    expect(result.lines[0]).toMatchObject({ status: 'in_doubt', reason: 'interrupted' });
    expect(result.attention).toMatchObject({ kind: 'blocked' });
  });

  it('should flag a sale larger than the stock OpenLinker mirrored as clamped', async () => {
    positions = [position({ availableQuantity: 1 })];
    shop().adjustInventory.mockResolvedValue(adjusted(0, HONOURED));

    const result = await service.decrementForWork(
      input({
        lines: [
          { orderLineId: 'line-1', productId: 'ol_product_1', productVariantId: 'ol_variant_1', quantity: 3 },
        ],
      })
    );

    expect(repository.rows.get('sale:conn-shop:w-1:line-1')).toMatchObject({ clamped: true });
    expect(result.attention).toEqual({
      kind: 'blocked',
      detail: '1 line(s) sold more than the stock OpenLinker saw',
    });
  });

  // The issue's regression: the last unit sells on Allegro with the OMS on.
  it('should take the master to 0 and publish it when the last unit sells', async () => {
    positions = [position({ availableQuantity: 1 })];
    shop().adjustInventory.mockResolvedValue(adjusted(0, HONOURED));

    const result = await service.decrementForWork(input());

    expect(result.lines[0]).toMatchObject({ status: 'applied' });
    expect(result.attention).toEqual({ kind: 'none' });
    expect(inventoryService.setInventory).toHaveBeenCalledWith(
      expect.objectContaining({ availableQuantity: 0 }),
      'conn-shop'
    );
  });

  it('should send a product-level line without a variant id', async () => {
    positions = [position({ productVariantId: null })];

    await service.decrementForWork(
      input({
        lines: [{ orderLineId: 'line-1', productId: 'ol_product_1', productVariantId: null, quantity: 1 }],
      })
    );

    expect(shop().adjustInventory).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: undefined, quantity: -1 })
    );
  });

  // The master is already lowered; a mirror failure must not fail the line.
  it('should keep the line applied when the mirror write fails', async () => {
    inventoryService.setInventory.mockRejectedValue(new Error('db blip'));

    const result = await service.decrementForWork(input());

    expect(result.lines[0]).toMatchObject({ status: 'applied' });
  });
});
