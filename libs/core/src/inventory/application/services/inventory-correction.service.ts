/**
 * Inventory Correction Service (#3566, epic #3512)
 *
 * The operator's manual stock correction. Copies the shape of
 * {@link InventorySaleDecrementService}: the owner comes from position
 * provenance, the adapter is built BEFORE the claim, the ledger row is claimed
 * BEFORE the boundary is crossed, any throw from the write that is not a known
 * refusal is `in_doubt` and never retried, and the master's own answer is
 * mirrored through `setInventory` so marketplaces follow.
 *
 * ## Order, and why
 *
 * 1. Target - which master owns the variant. A refusal writes nothing.
 * 2. Replay - a key that already exists answers from its row; the adapter is
 *    not called a second time and the thresholds are not re-evaluated against a
 *    stock that has since moved.
 * 3. Delta - `set` mode reads the master's CURRENT quantity (a failed read
 *    refuses; nothing is guessed from the mirror), `delta` mode uses the mirror
 *    for the threshold only.
 * 4. D41 - a large change needs an explicit confirmation.
 * 5. Position lock around claim -> write -> mirror, shared with the sale
 *    decrement so the two cannot interleave their mirror writes.
 * 6. Claim (`pending`), write, then `applied` / `refused` / `in_doubt`.
 *
 * @module libs/core/src/inventory/application/services
 */
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  MasterProductNotFoundError,
  PRODUCTS_SERVICE_TOKEN,
  type IProductsService,
} from '@openlinker/core/products';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { InventoryItem } from '../../domain/entities/inventory-item.entity';
import type { InventoryMovement } from '../../domain/entities/inventory-movement.entity';
import {
  CorrectionConfirmationRequiredError,
  CorrectionContendedError,
  InventoryCorrectionRefusedError,
  InventoryCorrectionTargetRefusedError,
  InventoryCorrectionVariantNotFoundError,
} from '../../domain/exceptions/inventory-correction.errors';
import type {
  InventoryAdjustmentResult,
  InventoryMasterPort,
} from '../../domain/ports/inventory-master.port';
import { InventoryMovementRepositoryPort } from '../../domain/ports/inventory-movement-repository.port';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import {
  requiresLargeChangeConfirmation,
  resolveRecordedQuantityBefore,
  type CorrectStockInput,
  type InventoryCorrectionAdjustmentOutcome,
  type InventoryCorrectionMaster,
  type InventoryCorrectionRefusalReason,
  type InventoryCorrectionTargetRefusalReason,
  type InventoryCorrectionResult,
  type InventoryCorrectionTarget,
} from '../../domain/types/inventory-correction.types';
import { resolveInventoryPositionOwner } from '../../domain/types/inventory-owner.types';
import type { InventoryOwnerPosition } from '../../domain/types/inventory.types';
import {
  saleDecrementPositionLockKey,
  SALE_DECREMENT_POSITION_LOCK_TTL_MS,
} from '../../domain/types/inventory-sale-decrement.types';
import {
  INVENTORY_MOVEMENT_REPOSITORY_TOKEN,
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
} from '../../inventory.tokens';
import type { IInventoryCorrectionService } from './inventory-correction.service.interface';
import { IInventoryService } from './inventory.service.interface';

interface ResolvedTarget {
  readonly productId: string;
  readonly productVariantId: string;
  readonly owner: string;
  readonly position: InventoryOwnerPosition;
  readonly currentQuantity: number;
  readonly connection: Connection;
}

type TargetResolution =
  | { readonly kind: 'ready'; readonly target: ResolvedTarget }
  | { readonly kind: 'refused'; readonly reason: InventoryCorrectionTargetRefusalReason };

@Injectable()
export class InventoryCorrectionService implements IInventoryCorrectionService {
  private readonly logger = new Logger(InventoryCorrectionService.name);

  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(INVENTORY_MOVEMENT_REPOSITORY_TOKEN)
    private readonly movements: InventoryMovementRepositoryPort,
    @Inject(INVENTORY_SERVICE_TOKEN)
    private readonly inventoryService: IInventoryService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort
  ) {}

  async getCorrectionTarget(input: {
    productVariantId: string;
  }): Promise<InventoryCorrectionTarget> {
    const resolution = await this.resolveTarget(input.productVariantId);
    if (resolution.kind === 'refused') {
      return { kind: 'refused', reason: resolution.reason };
    }
    const { target } = resolution;
    return {
      kind: 'ready',
      productId: target.productId,
      productVariantId: target.productVariantId,
      connectionId: target.owner,
      connectionName: target.connection.name,
      platformType: target.connection.platformType,
      currentQuantity: target.currentQuantity,
    };
  }

  async correctStock(input: CorrectStockInput): Promise<InventoryCorrectionResult> {
    if (!Number.isInteger(input.quantity) || (input.mode === 'set' && input.quantity < 0)) {
      throw new InventoryCorrectionRefusedError(
        'invalid-quantity',
        input.mode === 'set'
          ? 'The wanted stock must be a whole number of 0 or more'
          : 'The change must be a whole number of units'
      );
    }
    const note = input.note?.trim() ?? '';
    if (input.operatorReason === 'other' && note === '') {
      throw new InventoryCorrectionRefusedError(
        'note-required',
        'A note is required when the reason is "other"'
      );
    }

    const resolution = await this.resolveTarget(input.productVariantId);
    if (resolution.kind === 'refused') {
      throw new InventoryCorrectionTargetRefusedError(resolution.reason);
    }
    const { target } = resolution;
    const master: InventoryCorrectionMaster = {
      connectionId: target.owner,
      connectionName: target.connection.name,
      platformType: target.connection.platformType,
    };

    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    if (input.idempotencyKey !== undefined) {
      const existing = await this.movements.findByIdempotencyKey(idempotencyKey);
      if (existing !== null) {
        return this.replay(existing, target, master, input);
      }
    }

    const adapter = await this.buildAdapter(target.owner);

    let currentForThreshold = target.currentQuantity;
    let delta = input.quantity;
    // The pre-write master read: the mirror can be stale, so every judgement that
    // depends on how much the master holds (set's delta, the removal guard) uses
    // the master itself. A positive delta needs no read.
    let preWriteMasterQuantity = target.currentQuantity;
    if (input.mode === 'set' || input.quantity < 0) {
      const masterQuantity = await this.readMasterQuantity(adapter, target);
      preWriteMasterQuantity = masterQuantity;
      currentForThreshold = masterQuantity;
      if (input.mode === 'set') delta = input.quantity - masterQuantity;
    }
    if (delta === 0) {
      throw new InventoryCorrectionRefusedError(
        'no-change',
        'The stock already equals the wanted quantity; nothing to change'
      );
    }
    if (input.mode === 'delta' && currentForThreshold + delta < 0) {
      // Refused before any master write, judged against the master's own stock:
      // a removal larger than it can never be the operator's intent. A change
      // landing between this read and the write may still be clamped; the
      // ledger then records the real before/after.
      throw new InventoryCorrectionRefusedError(
        'insufficient-stock',
        `Cannot remove ${String(-delta)} units: only ${String(currentForThreshold)} in stock`,
        currentForThreshold
      );
    }
    if (requiresLargeChangeConfirmation(delta, currentForThreshold) && input.confirmLargeChange !== true) {
      throw new CorrectionConfirmationRequiredError(delta, currentForThreshold);
    }

    const lockKey = saleDecrementPositionLockKey(
      target.owner,
      target.productId,
      target.productVariantId
    );
    const lockToken = await this.syncLock.acquire(lockKey, SALE_DECREMENT_POSITION_LOCK_TTL_MS);
    if (lockToken === null) {
      throw new CorrectionContendedError();
    }

    try {
      const claimed = await this.movements.insertPending({
        productId: target.productId,
        productVariantId: target.productVariantId,
        locationId: target.position.locationId,
        sourceConnectionId: target.owner,
        reason: 'manual_correction',
        quantityDelta: delta,
        sourceKind: 'operator',
        sourceRef: null,
        actorUserId: input.actorUserId,
        operatorReason: input.operatorReason,
        note: note === '' ? null : note,
        idempotencyKey,
        occurredAt: new Date(),
      });
      if (claimed === null) {
        // A peer claimed the same key between our read and this statement.
        const winner = await this.movements.findByIdempotencyKey(idempotencyKey);
        if (winner === null) {
          throw new Error(`Stock correction claim vanished: ${idempotencyKey}`);
        }
        return await this.replayLocked(winner, target, master, input);
      }

      return await this.cross(claimed, adapter, target, master, delta, preWriteMasterQuantity);
    } finally {
      await this.syncLock.release(lockKey, lockToken);
    }
  }

  /** Cross the boundary for a claimed row and settle it. Runs under the position lock. */
  private async cross(
    claimed: InventoryMovement,
    adapter: InventoryMasterPort,
    target: ResolvedTarget,
    master: InventoryCorrectionMaster,
    delta: number,
    preWriteMasterQuantity: number
  ): Promise<InventoryCorrectionResult> {
    let result: InventoryAdjustmentResult;
    try {
      result = await adapter.adjustInventory({
        productId: target.productId,
        variantId: target.productVariantId,
        quantity: delta,
        reason: 'manual_correction',
        idempotencyKey: `manual:${claimed.id}`,
      });
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim() !== ''
          ? error.message
          : 'the product master refused the adjustment without a message';
      const refusal = classifyKnownRefusal(error);
      if (refusal !== null) {
        await this.movements.settle(claimed.id, {
          status: 'refused',
          refusalReason: refusal,
          refusalDetail: detail,
        });
        this.logger.warn(
          `Manual stock correction refused by the product master: movement=${claimed.id} ` +
            `owner=${target.owner} reason=${refusal}`
        );
        return this.report(claimed.id, 'refused', delta, null, null, null, master, {
          reason: refusal,
          detail,
        });
      }
      // Unknown outcome: the master may or may not have applied it. Never retried.
      await this.movements.settle(claimed.id, { status: 'in_doubt', refusalDetail: detail });
      this.logger.error(
        `Manual stock correction is in doubt: movement=${claimed.id} owner=${target.owner}: ${detail}`
      );
      await this.refreshFromMaster(adapter, target);
      return this.report(claimed.id, 'in_doubt', delta, null, null, null, master, null);
    }

    const outcome = result.adjustmentOutcome;
    const adjustmentOutcome: InventoryCorrectionAdjustmentOutcome = {
      disposition: outcome?.disposition ?? 'applied',
      idempotency: outcome?.idempotency ?? 'unsupported',
      appliedAt: outcome?.appliedAt ?? null,
    };
    const resultingQuantity = Number.isFinite(result.available) ? result.available : null;

    const quantityBefore =
      resultingQuantity === null
        ? null
        : resolveRecordedQuantityBefore({
            requestedDelta: delta,
            resultingQuantity,
            preWriteMasterQuantity,
          });
    if (resultingQuantity !== null && quantityBefore !== null) {
      await this.mirror(target, resultingQuantity, claimed.id, quantityBefore);
    } else {
      this.logger.warn(
        `Manual stock correction ${claimed.id} applied, but the product master reported no ` +
          'quantity; the next stock sync will publish it'
      );
    }
    // setInventory completes the row through its best-effort ledger write, which
    // can fail silently. No `pending` row may survive a returned answer, so the
    // row is re-read and, if still pending, settled here. The recorded chain
    // describes the MASTER: before is what the master held when the claim was
    // made (read in set mode, the mirrored position in delta mode), after is what
    // it answered, and the recorded delta is after - before, NOT the request: a
    // master that clamps applies less. With no reported quantity both stay null
    // rather than being guessed from the mirror.
    const afterMirror = await this.movements.findById(claimed.id);
    if (afterMirror === null || afterMirror.status === 'pending') {
      await this.movements.settle(claimed.id, {
        status: 'applied',
        quantityBefore,
        quantityAfter: resultingQuantity,
        quantityDelta:
          resultingQuantity === null || quantityBefore === null
            ? undefined
            : resultingQuantity - quantityBefore,
      });
    }

    const row = await this.movements.findById(claimed.id);
    return this.report(
      claimed.id,
      'applied',
      delta,
      row?.quantityBefore ?? quantityBefore,
      row?.quantityAfter ?? resultingQuantity,
      adjustmentOutcome,
      master,
      null
    );
  }

  private async mirror(
    target: ResolvedTarget,
    availableQuantity: number,
    movementId: string,
    quantityBefore: number
  ): Promise<boolean> {
    try {
      await this.inventoryService.setInventory(
        this.toItem(target, availableQuantity, target.position.reservedQuantity),
        target.owner,
        { attachToMovementId: movementId, quantityBefore }
      );
      return true;
    } catch (error) {
      // The master is already changed; only the mirror and its propagation are
      // late, and the next stock sync repairs both.
      this.logger.warn(
        `Manual stock correction ${movementId} landed, but the stock mirror could not be ` +
          `updated: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /** After an unknown outcome the marketplaces should at least show the master's real number. */
  private async refreshFromMaster(
    adapter: InventoryMasterPort,
    target: ResolvedTarget
  ): Promise<void> {
    try {
      const entry = await this.findMasterEntry(adapter, target);
      if (entry === undefined) return;
      await this.inventoryService.setInventory(
        this.toItem(target, entry.available, entry.reserved),
        target.owner
      );
    } catch (error) {
      this.logger.warn(
        `Could not re-read the product master's stock after an in-doubt correction: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  private toItem(target: ResolvedTarget, available: number, reserved: number): InventoryItem {
    return new InventoryItem(
      target.position.inventoryItemId,
      target.position.productId,
      target.position.productVariantId,
      available,
      reserved,
      target.position.locationId,
      new Date(),
      false,
      target.owner
    );
  }

  private async findMasterEntry(
    adapter: InventoryMasterPort,
    target: ResolvedTarget
  ): Promise<{ available: number; reserved: number } | undefined> {
    const entries = await adapter.listInventory(target.productId);
    // Never another variant's number: the lone-entry fallback is for a master
    // that reports one product-level entry (no variant id) only.
    return (
      entries.find((entry) => entry.variantId === target.productVariantId) ??
      (entries.length === 1 && !entries[0].variantId ? entries[0] : undefined)
    );
  }

  private async readMasterQuantity(
    adapter: InventoryMasterPort,
    target: ResolvedTarget
  ): Promise<number> {
    try {
      const entry = await this.findMasterEntry(adapter, target);
      if (entry !== undefined && Number.isFinite(entry.available)) {
        return entry.available;
      }
    } catch (error) {
      throw new InventoryCorrectionRefusedError(
        'master-unreadable',
        `The product master's current stock could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    throw new InventoryCorrectionRefusedError(
      'master-unreadable',
      "The product master's answer did not include this variant's stock"
    );
  }

  /** Answer from an existing row, taking the lock only when it is still `pending`. */
  private async replay(
    existing: InventoryMovement,
    target: ResolvedTarget,
    master: InventoryCorrectionMaster,
    input: CorrectStockInput
  ): Promise<InventoryCorrectionResult> {
    if (existing.status !== 'pending') {
      return this.replayLocked(existing, target, master, input);
    }
    // A pending row is either a live peer or a dead process; only the position
    // lock tells them apart.
    const lockKey = saleDecrementPositionLockKey(
      target.owner,
      target.productId,
      target.productVariantId
    );
    const lockToken = await this.syncLock.acquire(lockKey, SALE_DECREMENT_POSITION_LOCK_TTL_MS);
    if (lockToken === null) {
      throw new CorrectionContendedError();
    }
    try {
      const fresh = (await this.movements.findById(existing.id)) ?? existing;
      return await this.replayLocked(fresh, target, master, input);
    } finally {
      await this.syncLock.release(lockKey, lockToken);
    }
  }

  private async replayLocked(
    existing: InventoryMovement,
    target: ResolvedTarget,
    master: InventoryCorrectionMaster,
    input: CorrectStockInput
  ): Promise<InventoryCorrectionResult> {
    if (
      existing.productVariantId !== target.productVariantId ||
      existing.reason !== 'manual_correction' ||
      !this.sameRequest(existing, input)
    ) {
      throw new InventoryCorrectionRefusedError(
        'idempotency-key-reused',
        'This idempotency key was already used for a different stock change'
      );
    }
    let row = existing;
    if (row.status === 'pending') {
      // The process that claimed it died mid-call; never send it again.
      await this.movements.settle(row.id, {
        status: 'in_doubt',
        refusalDetail: 'the correction was interrupted before the product master answered',
      });
      this.logger.error(`Manual stock correction ${row.id} was interrupted; marking it in doubt`);
      row = (await this.movements.findById(row.id)) ?? row;
    }
    const status = row.status === 'pending' ? 'in_doubt' : row.status;
    return {
      status,
      movementId: row.id,
      requestedDelta: row.quantityDelta,
      quantityBefore: row.quantityBefore,
      quantityAfter: row.quantityAfter,
      adjustmentOutcome: null,
      master,
      refusal:
        status === 'refused'
          ? { reason: row.refusalReason ?? 'master-refused', detail: row.refusalDetail }
          : null,
      deduplicated: true,
    };
  }

  /**
   * A replay must ask for the same change. The ledger stores no mode, so the
   * comparison is by shape. `set` compares the requested target with the stored
   * resulting quantity of an applied row (its delta depends on the master's stock
   * at claim time, which a replay does not re-read; a row that never applied has
   * no target and only the reason is compared). `delta` compares the delta
   * directly, and also accepts a smaller recorded delta of the same sign when the
   * row applied and landed on 0: that is a clamp, the only way the master applies
   * less than asked.
   *
   * Limits: a cross-mode replay whose numbers coincide is accepted, because the
   * ledger stores no mode and a column for a client bug is not worth a migration;
   * one whose numbers differ stays `idempotency-key-reused`. The original request
   * is not stored either, so a replay reports the row's recorded delta as
   * `requestedDelta` - the applied change, which differs from the first answer's
   * request only after a clamp or in set mode.
   */
  private sameRequest(existing: InventoryMovement, input: CorrectStockInput): boolean {
    if (existing.operatorReason !== input.operatorReason) return false;
    if (input.mode === 'delta') {
      if (existing.quantityDelta === input.quantity) return true;
      return (
        existing.status === 'applied' &&
        existing.quantityAfter === 0 &&
        Math.sign(existing.quantityDelta) === Math.sign(input.quantity) &&
        Math.abs(existing.quantityDelta) < Math.abs(input.quantity)
      );
    }
    return existing.quantityAfter === null || existing.quantityAfter === input.quantity;
  }

  private report(
    movementId: string,
    status: InventoryCorrectionResult['status'],
    requestedDelta: number,
    quantityBefore: number | null,
    quantityAfter: number | null,
    adjustmentOutcome: InventoryCorrectionAdjustmentOutcome | null,
    master: InventoryCorrectionMaster,
    refusal: { reason: string; detail: string | null } | null
  ): InventoryCorrectionResult {
    return {
      status,
      movementId,
      requestedDelta,
      quantityBefore,
      quantityAfter,
      adjustmentOutcome,
      master,
      refusal,
      deduplicated: false,
    };
  }

  private async buildAdapter(owner: string): Promise<InventoryMasterPort> {
    try {
      return await this.integrations.getCapabilityAdapter<InventoryMasterPort>(
        owner,
        'InventoryMaster'
      );
    } catch (error) {
      this.logger.warn(
        `Stock correction: the owner's adapter could not be built: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw new InventoryCorrectionTargetRefusedError('adapter-unresolved');
    }
  }

  /**
   * Which ACTIVE `InventoryMaster` connection owns the variant's stock. Reads
   * positions only and lists adapters lazily, so no adapter is built here.
   */
  private async resolveTarget(productVariantId: string): Promise<TargetResolution> {
    const variant = await this.products.getVariant(productVariantId);
    if (variant === null) {
      throw new InventoryCorrectionVariantNotFoundError(productVariantId);
    }

    let candidates: Array<{ connectionId: string; connection: Connection }>;
    try {
      candidates = await this.integrations.listCapabilityAdapters<InventoryMasterPort>({
        capability: 'InventoryMaster',
        lazy: true,
      });
    } catch (error) {
      this.logger.error(
        `Could not list InventoryMaster connections for a stock correction: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return { kind: 'refused', reason: 'adapter-unresolved' };
    }
    if (candidates.length === 0) {
      return { kind: 'refused', reason: 'no-inventory-master' };
    }

    const positions = await this.inventoryRepository.findLiveOwnerPositions([variant.productId]);
    const owner = resolveInventoryPositionOwner(positions, {
      productId: variant.productId,
      productVariantId: variant.id,
      locationId: null,
    });
    if (owner.kind === 'blocked') {
      return {
        kind: 'refused',
        reason: owner.reason === 'ambiguous-owner' ? 'ambiguous-inventory-master' : owner.reason,
      };
    }

    const candidate = candidates.find((entry) => entry.connectionId === owner.ownerConnectionId);
    if (candidate === undefined) {
      return { kind: 'refused', reason: 'adapter-unresolved' };
    }

    return {
      kind: 'ready',
      target: {
        productId: variant.productId,
        productVariantId: variant.id,
        owner: owner.ownerConnectionId,
        position: owner.position,
        currentQuantity: owner.availableQuantity,
        connection: candidate.connection,
      },
    };
  }
}

/**
 * Recognise a refusal the master states on purpose, by shape: core cannot name a
 * platform exception type. Anything else is an unknown outcome, never a refusal -
 * a network or 5xx failure may have applied the change.
 */
function classifyKnownRefusal(error: unknown): InventoryCorrectionRefusalReason | null {
  if (error instanceof MasterProductNotFoundError) return 'master-product-not-found';
  if (error instanceof Error && /NotSupported(Exception|Error)?$/.test(error.name)) {
    return 'master-refused';
  }
  return null;
}
