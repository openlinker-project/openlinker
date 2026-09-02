/**
 * Inventory adjustment vocabulary — unit tests (#2368)
 *
 * Pins the two properties a consumer of `InventoryMasterPort.adjustInventory`
 * depends on and that nothing else in the tree can assert: the closed reason
 * vocabulary, and the rule that an ABSENT `adjustmentOutcome` is read as
 * `idempotency: 'unsupported'` rather than as a honoured dedupe.
 *
 * @module libs/core/src/inventory/domain/types/__tests__
 */
import {
  InventoryAdjustmentReasonValues,
  InventoryAdjustmentDispositionValues,
  InventoryIdempotencySupportValues,
  type InventoryIdempotencySupport,
} from '../inventory.types';
import type { InventoryAdjustmentResult } from '../../ports/inventory-master.port';

/**
 * The rule every caller must apply, spelled once here so the assertion is about
 * the rule rather than about one caller's copy of it.
 */
function readIdempotency(result: InventoryAdjustmentResult): InventoryIdempotencySupport {
  return result.adjustmentOutcome?.idempotency ?? 'unsupported';
}

const baseResult: InventoryAdjustmentResult = {
  id: 'ol_inventory_1',
  productId: 'ol_product_1',
  quantity: 5,
  reserved: 0,
  available: 5,
};

describe('inventory adjustment vocabulary', () => {
  it('should expose exactly the two reasons a shipped caller writes', () => {
    expect(InventoryAdjustmentReasonValues).toEqual(['return_restock', 'manual_correction']);
  });

  it('should expose deduplicated as a disposition, not a refusal', () => {
    expect(InventoryAdjustmentDispositionValues).toEqual(['applied', 'deduplicated']);
  });

  it('should let an adapter say it cannot dedupe', () => {
    expect(InventoryIdempotencySupportValues).toContain('unsupported');
    expect(InventoryIdempotencySupportValues).toContain('not_requested');
  });

  it('should read an absent outcome as unsupported when the adapter predates #2368', () => {
    expect(readIdempotency(baseResult)).toBe('unsupported');
  });

  it('should read a reported outcome verbatim', () => {
    expect(
      readIdempotency({
        ...baseResult,
        adjustmentOutcome: { disposition: 'deduplicated', idempotency: 'honoured', appliedAt: null },
      }),
    ).toBe('honoured');
  });
});
