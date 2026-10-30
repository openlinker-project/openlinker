/**
 * InventoryCorrectionService - spec (#3566)
 *
 * The movement ledger is an in-memory fake that honours the claim semantics
 * (unique idempotency key, settle guarded on `pending`), so replay and crash
 * cases exercise the real guarantee rather than a mock's return value.
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { MasterProductNotFoundError, type IProductsService } from '@openlinker/core/products';
import type { SyncLockPort } from '@openlinker/core/sync';

import { InventoryMovement } from '../../../domain/entities/inventory-movement.entity';
import {
  CorrectionConfirmationRequiredError,
  CorrectionContendedError,
  InventoryCorrectionRefusedError,
  InventoryCorrectionTargetRefusedError,
  InventoryCorrectionVariantNotFoundError,
} from '../../../domain/exceptions/inventory-correction.errors';
import type { InventoryAdjustmentResult } from '../../../domain/ports/inventory-master.port';
import type { InventoryMovementRepositoryPort } from '../../../domain/ports/inventory-movement-repository.port';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import type {
  InsertPendingInventoryMovementInput,
  SettleInventoryMovementInput,
} from '../../../domain/types/inventory-movement.types';
import type { InventoryOwnerPosition } from '../../../domain/types/inventory.types';
import { InventoryCorrectionService } from '../inventory-correction.service';
import type { IInventoryService } from '../inventory.service.interface';

/* eslint-disable @typescript-eslint/require-await -- an in-memory fake of an async port: bodies are synchronous by design */
class InMemoryMovementRepository {
  readonly rows = new Map<string, InventoryMovement>();
  private seq = 0;

  insertPending = jest.fn(
    async (input: InsertPendingInventoryMovementInput): Promise<InventoryMovement | null> => {
      if (this.byKey(input.idempotencyKey) !== undefined) return null;
      this.seq += 1;
      const row = new InventoryMovement(
        `mov-${String(this.seq)}`,
        input.productId,
        input.productVariantId,
        input.locationId,
        input.sourceConnectionId,
        input.reason,
        'pending',
        input.quantityDelta,
        null,
        null,
        input.sourceKind,
        input.sourceRef,
        input.actorUserId,
        input.operatorReason,
        input.note,
        input.idempotencyKey,
        null,
        null,
        input.occurredAt,
        new Date()
      );
      this.rows.set(row.id, row);
      return row;
    }
  );

  findByIdempotencyKey = jest.fn(async (key: string) => this.byKey(key) ?? null);
  findById = jest.fn(async (id: string) => this.rows.get(id) ?? null);

  settle = jest.fn(async (id: string, s: SettleInventoryMovementInput): Promise<boolean> => {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== 'pending') return false;
    this.rows.set(id, this.with(row, s.status, s));
    return true;
  });

  attachQuantities = jest.fn(
    async (id: string, before: number, after: number): Promise<boolean> => {
      const row = this.rows.get(id);
      if (row === undefined || row.status !== 'pending') return false;
      this.rows.set(id, this.with(row, 'applied', { status: 'applied', quantityBefore: before, quantityAfter: after, quantityDelta: after - before }));
      return true;
    }
  );

  private byKey(key: string): InventoryMovement | undefined {
    return [...this.rows.values()].find((row) => row.idempotencyKey === key);
  }

  private with(
    row: InventoryMovement,
    status: InventoryMovement['status'],
    s: SettleInventoryMovementInput
  ): InventoryMovement {
    return new InventoryMovement(
      row.id,
      row.productId,
      row.productVariantId,
      row.locationId,
      row.sourceConnectionId,
      row.reason,
      status,
      s.quantityDelta ?? row.quantityDelta,
      s.quantityBefore ?? row.quantityBefore,
      s.quantityAfter ?? row.quantityAfter,
      row.sourceKind,
      row.sourceRef,
      row.actorUserId,
      row.operatorReason,
      row.note,
      row.idempotencyKey,
      s.refusalReason ?? null,
      s.refusalDetail ?? null,
      row.occurredAt,
      row.createdAt
    );
  }
}
/* eslint-enable @typescript-eslint/require-await -- end of the in-memory fake */

const VARIANT_ID = 'ol_variant_1';
const PRODUCT_ID = 'ol_product_1';
const OWNER = 'conn-ps';

function position(over: Partial<InventoryOwnerPosition> = {}): InventoryOwnerPosition {
  return {
    inventoryItemId: 'inv-1',
    productId: PRODUCT_ID,
    productVariantId: VARIANT_ID,
    locationId: null,
    sourceConnectionId: OWNER,
    availableQuantity: 10,
    reservedQuantity: 1,
    ...over,
  };
}

interface Harness {
  service: InventoryCorrectionService;
  movements: InMemoryMovementRepository;
  adapter: { adjustInventory: jest.Mock; listInventory: jest.Mock };
  inventoryService: { setInventory: jest.Mock };
  integrations: { listCapabilityAdapters: jest.Mock; getCapabilityAdapter: jest.Mock };
  syncLock: { acquire: jest.Mock; release: jest.Mock };
  inventoryRepository: { findLiveOwnerPositions: jest.Mock };
  products: { getVariant: jest.Mock };
}

function build(): Harness {
  const movements = new InMemoryMovementRepository();
  const adapter = {
    adjustInventory: jest.fn(
      (): Promise<InventoryAdjustmentResult> =>
        Promise.resolve({
          id: 'x',
          productId: PRODUCT_ID,
          quantity: 15,
          reserved: 1,
          available: 15,
          adjustmentOutcome: { disposition: 'applied', idempotency: 'honoured', appliedAt: null },
        })
    ),
    listInventory: jest.fn(() =>
      Promise.resolve([
        { id: 'x', productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 10, reserved: 1, available: 10 },
      ])
    ),
  };
  const inventoryService = {
    setInventory: jest.fn(
      async (
        item: { availableQuantity: number },
        _owner: unknown,
        ctx?: { attachToMovementId: string; quantityBefore: number }
      ) => {
        if (ctx !== undefined) {
          await movements.attachQuantities(ctx.attachToMovementId, ctx.quantityBefore, item.availableQuantity);
        }
      }
    ),
  };
  const integrations = {
    listCapabilityAdapters: jest.fn().mockResolvedValue([
      { connectionId: OWNER, connection: { id: OWNER, name: 'Shop', platformType: 'prestashop' }, adapter: {} },
    ]),
    getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
  };
  const syncLock = {
    acquire: jest.fn().mockResolvedValue('token'),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const inventoryRepository = {
    findLiveOwnerPositions: jest.fn().mockResolvedValue([position()]),
  };
  const products = {
    getVariant: jest.fn().mockResolvedValue({ id: VARIANT_ID, productId: PRODUCT_ID }),
  };
  const service = new InventoryCorrectionService(
    inventoryRepository as unknown as InventoryRepositoryPort,
    movements as unknown as InventoryMovementRepositoryPort,
    inventoryService as unknown as IInventoryService,
    integrations as unknown as IIntegrationsService,
    products as unknown as IProductsService,
    syncLock as unknown as SyncLockPort
  );
  return { service, movements, adapter, inventoryService, integrations, syncLock, inventoryRepository, products };
}

const baseInput = {
  productVariantId: VARIANT_ID,
  mode: 'delta' as const,
  quantity: 5,
  operatorReason: 'found' as const,
  actorUserId: 'user-1',
};

describe('InventoryCorrectionService', () => {
  describe('getCorrectionTarget', () => {
    it('should name the owning master and the mirrored stock when one owner holds the variant', async () => {
      const h = build();
      await expect(h.service.getCorrectionTarget({ productVariantId: VARIANT_ID })).resolves.toEqual({
        kind: 'ready',
        productId: PRODUCT_ID,
        productVariantId: VARIANT_ID,
        connectionId: OWNER,
        connectionName: 'Shop',
        platformType: 'prestashop',
        currentQuantity: 10,
      });
      expect(h.integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should throw not-found when the variant is unknown', async () => {
      const h = build();
      h.products.getVariant.mockResolvedValue(null);
      await expect(h.service.getCorrectionTarget({ productVariantId: 'nope' })).rejects.toBeInstanceOf(
        InventoryCorrectionVariantNotFoundError
      );
    });

    it('should refuse with no-inventory-master when no connection claims the capability', async () => {
      const h = build();
      h.integrations.listCapabilityAdapters.mockResolvedValue([]);
      await expect(h.service.getCorrectionTarget({ productVariantId: VARIANT_ID })).resolves.toEqual({
        kind: 'refused',
        reason: 'no-inventory-master',
      });
    });

    it('should refuse with ambiguous-inventory-master when positions name two owners', async () => {
      const h = build();
      h.inventoryRepository.findLiveOwnerPositions.mockResolvedValue([
        position(),
        position({ inventoryItemId: 'inv-2', sourceConnectionId: 'conn-woo' }),
      ]);
      await expect(h.service.getCorrectionTarget({ productVariantId: VARIANT_ID })).resolves.toEqual({
        kind: 'refused',
        reason: 'ambiguous-inventory-master',
      });
    });

    it('should refuse with no-position when the variant has no live position', async () => {
      const h = build();
      h.inventoryRepository.findLiveOwnerPositions.mockResolvedValue([]);
      await expect(h.service.getCorrectionTarget({ productVariantId: VARIANT_ID })).resolves.toEqual({
        kind: 'refused',
        reason: 'no-position',
      });
    });

    it('should refuse with unattributed-owner when the position carries legacy provenance', async () => {
      const h = build();
      h.inventoryRepository.findLiveOwnerPositions.mockResolvedValue([
        position({ sourceConnectionId: 'legacy' }),
      ]);
      await expect(h.service.getCorrectionTarget({ productVariantId: VARIANT_ID })).resolves.toEqual({
        kind: 'refused',
        reason: 'unattributed-owner',
      });
    });

    it('should refuse with adapter-unresolved when the owner is not an active candidate', async () => {
      const h = build();
      h.integrations.listCapabilityAdapters.mockResolvedValue([
        { connectionId: 'other', connection: { id: 'other', name: 'O', platformType: 'woocommerce' }, adapter: {} },
      ]);
      await expect(h.service.getCorrectionTarget({ productVariantId: VARIANT_ID })).resolves.toEqual({
        kind: 'refused',
        reason: 'adapter-unresolved',
      });
    });
  });

  describe('correctStock', () => {
    it('should throw a target refusal and write nothing when no master owns the variant', async () => {
      const h = build();
      h.integrations.listCapabilityAdapters.mockResolvedValue([]);
      await expect(h.service.correctStock(baseInput)).rejects.toBeInstanceOf(
        InventoryCorrectionTargetRefusedError
      );
      expect(h.movements.insertPending).not.toHaveBeenCalled();
      expect(h.adapter.adjustInventory).not.toHaveBeenCalled();
    });

    it('should refuse note-required when the reason is other and the note is blank', async () => {
      const h = build();
      await expect(
        h.service.correctStock({ ...baseInput, operatorReason: 'other', note: '  ' })
      ).rejects.toMatchObject({ reason: 'note-required' });
      expect(h.movements.insertPending).not.toHaveBeenCalled();
    });

    it('should refuse invalid-quantity for a negative set target', async () => {
      const h = build();
      await expect(
        h.service.correctStock({ ...baseInput, mode: 'set', quantity: -1 })
      ).rejects.toMatchObject({ reason: 'invalid-quantity' });
    });

    it('should refuse no-change when set equals the current master quantity', async () => {
      const h = build();
      await expect(
        h.service.correctStock({ ...baseInput, mode: 'set', quantity: 10 })
      ).rejects.toMatchObject({ reason: 'no-change' });
      expect(h.movements.insertPending).not.toHaveBeenCalled();
    });

    it('should refuse no-change for a zero delta', async () => {
      const h = build();
      await expect(h.service.correctStock({ ...baseInput, quantity: 0 })).rejects.toBeInstanceOf(
        InventoryCorrectionRefusedError
      );
    });

    it('should refuse master-unreadable when the master read fails in set mode', async () => {
      const h = build();
      h.adapter.listInventory.mockRejectedValue(new Error('timeout'));
      await expect(
        h.service.correctStock({ ...baseInput, mode: 'set', quantity: 4 })
      ).rejects.toMatchObject({ reason: 'master-unreadable' });
      expect(h.movements.insertPending).not.toHaveBeenCalled();
    });

    it('should compute the delta from the master, not the mirror, in set mode', async () => {
      const h = build();
      h.adapter.listInventory.mockResolvedValue([
        { id: 'x', productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 20, reserved: 0, available: 20 },
      ]);
      const result = await h.service.correctStock({ ...baseInput, mode: 'set', quantity: 25 });
      expect(h.adapter.adjustInventory).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 5, reason: 'manual_correction', variantId: VARIANT_ID })
      );
      expect(result.requestedDelta).toBe(5);
    });

    it('should require confirmation above 50 units', async () => {
      const h = build();
      await expect(h.service.correctStock({ ...baseInput, quantity: 51 })).rejects.toBeInstanceOf(
        CorrectionConfirmationRequiredError
      );
      expect(h.movements.insertPending).not.toHaveBeenCalled();
    });

    it('should not require confirmation at exactly 50 units when current is 0', async () => {
      const h = build();
      h.inventoryRepository.findLiveOwnerPositions.mockResolvedValue([
        position({ availableQuantity: 0 }),
      ]);
      await expect(h.service.correctStock({ ...baseInput, quantity: 50 })).resolves.toMatchObject({
        status: 'applied',
      });
    });

    it('should require confirmation above 50% of a positive current stock', async () => {
      const h = build();
      // current 10: delta 6 is 60%.
      await expect(h.service.correctStock({ ...baseInput, quantity: 6 })).rejects.toBeInstanceOf(
        CorrectionConfirmationRequiredError
      );
    });

    it('should not require confirmation at exactly 50% of the current stock', async () => {
      const h = build();
      await expect(h.service.correctStock({ ...baseInput, quantity: 5 })).resolves.toMatchObject({
        status: 'applied',
      });
    });

    it('should proceed past the threshold when confirmLargeChange is true', async () => {
      const h = build();
      await expect(
        h.service.correctStock({ ...baseInput, quantity: 80, confirmLargeChange: true })
      ).resolves.toMatchObject({ status: 'applied' });
    });

    it('should throw contended and release nothing when the position lock is held', async () => {
      const h = build();
      h.syncLock.acquire.mockResolvedValue(null);
      await expect(h.service.correctStock(baseInput)).rejects.toBeInstanceOf(CorrectionContendedError);
      expect(h.movements.insertPending).not.toHaveBeenCalled();
      expect(h.syncLock.release).not.toHaveBeenCalled();
    });

    it('should apply, mirror with the claimed movement attached and release the lock', async () => {
      const h = build();
      const result = await h.service.correctStock({ ...baseInput, note: ' recount ' });

      expect(h.movements.insertPending).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'manual_correction',
          sourceKind: 'operator',
          sourceRef: null,
          actorUserId: 'user-1',
          operatorReason: 'found',
          note: 'recount',
          quantityDelta: 5,
          sourceConnectionId: OWNER,
        })
      );
      expect(h.adapter.adjustInventory).toHaveBeenCalledWith(
        expect.not.objectContaining({ locationId: expect.anything() as unknown })
      );
      expect(h.adapter.adjustInventory).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: `manual:${result.movementId}` })
      );
      expect(h.inventoryService.setInventory).toHaveBeenCalledWith(
        expect.anything(),
        OWNER,
        { attachToMovementId: result.movementId, quantityBefore: 10 }
      );
      expect(result).toMatchObject({
        status: 'applied',
        requestedDelta: 5,
        quantityBefore: 10,
        quantityAfter: 15,
        deduplicated: false,
        refusal: null,
        master: { connectionId: OWNER, connectionName: 'Shop', platformType: 'prestashop' },
        adjustmentOutcome: { disposition: 'applied', idempotency: 'honoured', appliedAt: null },
      });
      expect(h.syncLock.release).toHaveBeenCalledWith(expect.any(String), 'token');
    });

    const masterAnswers = (h: Harness, available: number): void => {
      h.adapter.adjustInventory.mockResolvedValue({
        id: 'x',
        productId: PRODUCT_ID,
        quantity: available,
        reserved: 0,
        available,
      });
    };
    const masterReads = (h: Harness, available: number): void => {
      h.adapter.listInventory.mockResolvedValue([
        { id: 'x', productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: available, reserved: 0, available },
      ]);
    };

    it('should not blame a concurrent sale on the operator when set mode lands above the read', async () => {
      const h = build();
      h.inventoryService.setInventory.mockResolvedValue(undefined);
      masterReads(h, 5);
      masterAnswers(h, 7);
      const result = await h.service.correctStock({ ...baseInput, mode: 'set', quantity: 8 });
      expect(result).toMatchObject({ quantityBefore: 4, quantityAfter: 7 });
      expect(h.movements.rows.get(result.movementId)?.quantityDelta).toBe(3);
    });

    it('should record before from the master answer in delta mode when the mirror is stale', async () => {
      const h = build();
      h.inventoryService.setInventory.mockResolvedValue(undefined);
      h.inventoryRepository.findLiveOwnerPositions.mockResolvedValue([position({ availableQuantity: 8 })]);
      masterReads(h, 7);
      masterAnswers(h, 6);
      const result = await h.service.correctStock({ ...baseInput, quantity: -1 });
      expect(result).toMatchObject({ quantityBefore: 7, quantityAfter: 6 });
      expect(h.movements.rows.get(result.movementId)?.quantityDelta).toBe(-1);
    });

    it('should record the read stock and applied delta when a race clamps a removal to zero', async () => {
      const h = build();
      h.inventoryService.setInventory.mockResolvedValue(undefined);
      masterReads(h, 3);
      masterAnswers(h, 0);
      const result = await h.service.correctStock({ ...baseInput, quantity: -3 });
      expect(result).toMatchObject({ quantityBefore: 3, quantityAfter: 0 });
      expect(h.movements.rows.get(result.movementId)?.quantityDelta).toBe(-3);
    });

    it('should record before from the answer when a positive delta is applied', async () => {
      const h = build();
      h.inventoryService.setInventory.mockResolvedValue(undefined);
      masterAnswers(h, 13);
      const result = await h.service.correctStock({ ...baseInput, quantity: 3 });
      expect(result).toMatchObject({ quantityBefore: 10, quantityAfter: 13 });
      expect(h.adapter.listInventory).not.toHaveBeenCalled();
    });

    it('should refuse insufficient-stock against the master read and write nothing when the mirror is stale-high', async () => {
      const h = build();
      h.inventoryRepository.findLiveOwnerPositions.mockResolvedValue([position({ availableQuantity: 9 })]);
      masterReads(h, 3);
      await expect(h.service.correctStock({ ...baseInput, quantity: -5 })).rejects.toMatchObject({
        reason: 'insufficient-stock',
        currentQuantity: 3,
      });
      expect(h.movements.insertPending).not.toHaveBeenCalled();
      expect(h.adapter.adjustInventory).not.toHaveBeenCalled();
    });

    it('should refuse master-unreadable for a removal when the master read fails', async () => {
      const h = build();
      h.adapter.listInventory.mockRejectedValue(new Error('down'));
      await expect(h.service.correctStock({ ...baseInput, quantity: -1 })).rejects.toMatchObject({
        reason: 'master-unreadable',
      });
      expect(h.adapter.adjustInventory).not.toHaveBeenCalled();
    });

    it('should refuse idempotency-key-reused when a set row is replayed with a delta body whose numbers differ', async () => {
      const h = build();
      h.inventoryService.setInventory.mockResolvedValue(undefined);
      const key = '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f31';
      masterReads(h, 10);
      masterAnswers(h, 15);
      await h.service.correctStock({ ...baseInput, mode: 'set', quantity: 15, idempotencyKey: key });
      await expect(
        h.service.correctStock({ ...baseInput, mode: 'delta', quantity: 7, idempotencyKey: key })
      ).rejects.toMatchObject({ reason: 'idempotency-key-reused' });
      expect(h.adapter.adjustInventory).toHaveBeenCalledTimes(1);
    });

    it('should report idempotency unsupported when the adapter reports no outcome', async () => {
      const h = build();
      h.adapter.adjustInventory.mockResolvedValue({
        id: 'x',
        productId: PRODUCT_ID,
        quantity: 15,
        reserved: 1,
        available: 15,
      });
      const result = await h.service.correctStock(baseInput);
      expect(result.adjustmentOutcome).toEqual({
        disposition: 'applied',
        idempotency: 'unsupported',
        appliedAt: null,
      });
    });

    it('should settle applied itself when the mirror write fails', async () => {
      const h = build();
      h.inventoryService.setInventory.mockRejectedValue(new Error('db down'));
      const result = await h.service.correctStock(baseInput);
      expect(h.movements.settle).toHaveBeenCalledWith(
        result.movementId,
        expect.objectContaining({ status: 'applied', quantityAfter: 15 })
      );
      expect(result.status).toBe('applied');
    });

    it('should settle the row itself when the mirror resolves but the ledger attach was swallowed', async () => {
      const h = build();
      h.inventoryService.setInventory.mockResolvedValue(undefined);
      const result = await h.service.correctStock(baseInput);
      const row = h.movements.rows.get(result.movementId);
      expect(row?.status).toBe('applied');
      expect(row?.quantityAfter).toBe(15);
      expect(row?.quantityBefore).toBe(10);
      expect(row?.quantityDelta).toBe(5);
    });

    it('should record no before/after when the master reports no resulting quantity', async () => {
      const h = build();
      h.adapter.adjustInventory.mockResolvedValue({
        id: 'x',
        productId: PRODUCT_ID,
        quantity: Number.NaN,
        reserved: 0,
        available: Number.NaN,
      });
      const result = await h.service.correctStock(baseInput);
      const row = h.movements.rows.get(result.movementId);
      expect(row?.status).toBe('applied');
      expect(row?.quantityBefore).toBeNull();
      expect(row?.quantityAfter).toBeNull();
      expect(result.quantityAfter).toBeNull();
      expect(h.inventoryService.setInventory).not.toHaveBeenCalled();
    });

    it('should refuse master-unreadable in set mode when the only entry belongs to another variant', async () => {
      const h = build();
      h.adapter.listInventory.mockResolvedValue([
        { id: 'x', productId: PRODUCT_ID, variantId: 'ol_variant_other', quantity: 3, reserved: 0, available: 3 },
      ]);
      await expect(
        h.service.correctStock({ ...baseInput, mode: 'set', quantity: 8 })
      ).rejects.toMatchObject({ reason: 'master-unreadable' });
      expect(h.adapter.adjustInventory).not.toHaveBeenCalled();
    });

    it('should use the lone product-level entry in set mode when it carries no variant id', async () => {
      const h = build();
      h.adapter.listInventory.mockResolvedValue([
        { id: 'x', productId: PRODUCT_ID, quantity: 3, reserved: 0, available: 3 },
      ]);
      await h.service.correctStock({ ...baseInput, mode: 'set', quantity: 8 });
      expect(h.movements.insertPending).toHaveBeenCalledWith(
        expect.objectContaining({ quantityDelta: 5 })
      );
    });

    it('should refuse idempotency-key-reused when the same key asks for a different quantity', async () => {
      const h = build();
      const key = '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f21';
      await h.service.correctStock({ ...baseInput, idempotencyKey: key });
      await expect(
        h.service.correctStock({ ...baseInput, quantity: 9, idempotencyKey: key })
      ).rejects.toMatchObject({ reason: 'idempotency-key-reused' });
      expect(h.adapter.adjustInventory).toHaveBeenCalledTimes(1);
    });

    it('should refuse idempotency-key-reused when the same key carries a different reason', async () => {
      const h = build();
      const key = '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f22';
      await h.service.correctStock({ ...baseInput, idempotencyKey: key });
      await expect(
        h.service.correctStock({ ...baseInput, operatorReason: 'damaged', idempotencyKey: key })
      ).rejects.toMatchObject({ reason: 'idempotency-key-reused' });
    });

    it('should settle refused with the verbatim sentence on a known not-supported refusal', async () => {
      const h = build();
      const error = new Error('multi-shop install: set shopId on the connection');
      error.name = 'PrestashopNotSupportedException';
      h.adapter.adjustInventory.mockRejectedValue(error);
      const result = await h.service.correctStock(baseInput);
      expect(result).toMatchObject({
        status: 'refused',
        refusal: { reason: 'master-refused', detail: 'multi-shop install: set shopId on the connection' },
        quantityAfter: null,
      });
      expect(h.inventoryService.setInventory).not.toHaveBeenCalled();
    });

    it('should settle refused master-product-not-found on MasterProductNotFoundError', async () => {
      const h = build();
      h.adapter.adjustInventory.mockRejectedValue(new MasterProductNotFoundError(PRODUCT_ID, OWNER));
      const result = await h.service.correctStock(baseInput);
      expect(result).toMatchObject({ status: 'refused', refusal: { reason: 'master-product-not-found' } });
    });

    it('should settle refused master-product-not-found when a delta removal reads a deleted product', async () => {
      const h = build();
      h.adapter.listInventory.mockRejectedValue(new MasterProductNotFoundError(PRODUCT_ID, OWNER));
      const result = await h.service.correctStock({ ...baseInput, quantity: -1 });
      expect(result).toMatchObject({
        status: 'refused',
        refusal: { reason: 'master-product-not-found' },
      });
      expect(h.movements.insertPending).toHaveBeenCalledTimes(1);
      expect(h.movements.settle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'refused', refusalReason: 'master-product-not-found' })
      );
      expect(h.adapter.adjustInventory).not.toHaveBeenCalled();
    });

    it('should settle refused master-product-not-found when set mode reads a deleted product', async () => {
      const h = build();
      h.adapter.listInventory.mockRejectedValue(new MasterProductNotFoundError(PRODUCT_ID, OWNER));
      const result = await h.service.correctStock({ ...baseInput, mode: 'set', quantity: 4 });
      expect(result).toMatchObject({
        status: 'refused',
        refusal: { reason: 'master-product-not-found' },
      });
      expect(h.adapter.adjustInventory).not.toHaveBeenCalled();
    });

    it('should settle in_doubt on any other throw and never call the adapter again', async () => {
      const h = build();
      h.adapter.adjustInventory.mockRejectedValue(new Error('socket hang up'));
      const key = '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f10';
      const first = await h.service.correctStock({ ...baseInput, idempotencyKey: key });
      expect(first.status).toBe('in_doubt');
      expect(first.refusal).toBeNull();

      const replay = await h.service.correctStock({ ...baseInput, idempotencyKey: key });
      expect(replay).toMatchObject({ status: 'in_doubt', deduplicated: true });
      expect(h.adapter.adjustInventory).toHaveBeenCalledTimes(1);
    });

    it('should return the existing outcome without calling the adapter on a duplicate key', async () => {
      const h = build();
      const key = '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f11';
      const first = await h.service.correctStock({ ...baseInput, idempotencyKey: key });
      const replay = await h.service.correctStock({
        ...baseInput,
        mode: 'set',
        quantity: 15,
        idempotencyKey: key,
      });
      expect(replay).toMatchObject({
        status: 'applied',
        deduplicated: true,
        movementId: first.movementId,
        adjustmentOutcome: null,
      });
      expect(h.adapter.adjustInventory).toHaveBeenCalledTimes(1);
    });

    it('should refuse a key already used for another variant', async () => {
      const h = build();
      const key = '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f12';
      await h.service.correctStock({ ...baseInput, idempotencyKey: key });
      h.products.getVariant.mockResolvedValue({ id: 'ol_variant_2', productId: PRODUCT_ID });
      h.inventoryRepository.findLiveOwnerPositions.mockResolvedValue([
        position({ productVariantId: 'ol_variant_2' }),
      ]);
      await expect(
        h.service.correctStock({ ...baseInput, productVariantId: 'ol_variant_2', idempotencyKey: key })
      ).rejects.toMatchObject({ reason: 'idempotency-key-reused' });
    });

    it('should mark an interrupted pending row in_doubt on replay and not resend', async () => {
      const h = build();
      const key = '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f13';
      await h.movements.insertPending({
        productId: PRODUCT_ID,
        productVariantId: VARIANT_ID,
        locationId: null,
        sourceConnectionId: OWNER,
        reason: 'manual_correction',
        quantityDelta: 5,
        sourceKind: 'operator',
        sourceRef: null,
        actorUserId: 'user-1',
        operatorReason: 'found',
        note: null,
        idempotencyKey: key,
        occurredAt: new Date(),
      });
      const replay = await h.service.correctStock({ ...baseInput, idempotencyKey: key });
      expect(replay).toMatchObject({ status: 'in_doubt', deduplicated: true });
      expect(h.adapter.adjustInventory).not.toHaveBeenCalled();
    });

    it('should release the lock even when the adapter throws', async () => {
      const h = build();
      h.adapter.adjustInventory.mockRejectedValue(new Error('boom'));
      await h.service.correctStock(baseInput);
      expect(h.syncLock.release).toHaveBeenCalledTimes(1);
    });

    it('should refuse adapter-unresolved before the claim when the adapter cannot be built', async () => {
      const h = build();
      h.integrations.getCapabilityAdapter.mockRejectedValue(new Error('no credentials'));
      await expect(h.service.correctStock(baseInput)).rejects.toMatchObject({
        reason: 'adapter-unresolved',
      });
      expect(h.movements.insertPending).not.toHaveBeenCalled();
    });
  });
});
