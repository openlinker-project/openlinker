/**
 * Restock Outcome Classification — unit tests (#2370)
 *
 * Every case here is a rule from #2368/#2369 that, read backwards, silently
 * moves or fails to move real stock. They are asserted individually rather than
 * through the service so a regression names the rule it broke.
 *
 * @module domain/domain-services
 */
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { InventoryAdjustmentResult } from '@openlinker/core/inventory';

import {
  blockedBeforeMaster,
  classifyRestockFailure,
  classifyRestockSuccess,
} from './restock-outcome.domain-service';

const baseInventory: InventoryAdjustmentResult = {
  id: 'inv-1',
  productId: 'ol_product_1',
  quantity: 5,
  reserved: 0,
  available: 5,
};

describe('classifyRestockSuccess', () => {
  it('should report idempotency as unsupported when the adapter reports no outcome at all', () => {
    // #2368: an ABSENT outcome is a pre-#2368 adapter. Reading it as a honoured
    // dedupe would let a retry skip a restock that never ran.
    const outcome = classifyRestockSuccess(baseInventory);

    expect(outcome.idempotencyUnsupported).toBe(true);
    expect(outcome.restockState).toBe('applied');
    expect(outcome.countsTowardRestocked).toBe(true);
  });

  it('should treat a deduplicated disposition as a success that still counts toward restocked', () => {
    // The units are already in the master's book — the caller must not count
    // them twice, but it must also not treat this as a failure.
    const outcome = classifyRestockSuccess({
      ...baseInventory,
      adjustmentOutcome: {
        disposition: 'deduplicated',
        idempotency: 'honoured',
        appliedAt: null,
      },
    });

    expect(outcome.restockState).toBe('deduplicated');
    expect(outcome.countsTowardRestocked).toBe(true);
    expect(outcome.restockedBy).toBe('inventory_master');
    expect(outcome.idempotencyUnsupported).toBe(false);
  });

  it('should succeed when appliedAt is null, because PrestaShop always reports it so', () => {
    // #2369: `stock_availables` has no timestamp column. Treating `appliedAt`
    // as evidence of success would classify every PrestaShop restock a failure.
    const outcome = classifyRestockSuccess({
      ...baseInventory,
      adjustmentOutcome: { disposition: 'applied', idempotency: 'honoured', appliedAt: null },
    });

    expect(outcome.restockState).toBe('applied');
    expect(outcome.countsTowardRestocked).toBe(true);
  });

  it('should block when the adapter reports a disposition this build does not understand', () => {
    const outcome = classifyRestockSuccess({
      ...baseInventory,
      adjustmentOutcome: {
        disposition: 'partially-applied' as never,
        idempotency: 'unsupported',
        appliedAt: null,
      },
    });

    expect(outcome.restockState).toBe('blocked');
    expect(outcome.restockBlockedReason).toBe('unknown');
    expect(outcome.countsTowardRestocked).toBe(false);
  });
});

describe('classifyRestockFailure', () => {
  it('should distinguish a master-side product absence from a generic refusal', () => {
    const outcome = classifyRestockFailure(
      new MasterProductNotFoundError('ol_product_1', 'conn-1')
    );

    expect(outcome.restockBlockedReason).toBe('master-product-not-found');
    expect(outcome.countsTowardRestocked).toBe(false);
  });

  it('should carry the adapter own message verbatim so an operator can quote it', () => {
    const outcome = classifyRestockFailure(
      new Error('PrestaShop refuses stock writes for advanced stock management products')
    );

    expect(outcome.restockBlockedReason).toBe('master-refused');
    expect(outcome.restockBlockedDetail).toContain('advanced stock management');
  });

  it('should classify a non-Error throw without losing the block', () => {
    const outcome = classifyRestockFailure('something went wrong');

    expect(outcome.restockState).toBe('blocked');
    expect(outcome.restockBlockedDetail).not.toBeNull();
    expect(outcome.countsTowardRestocked).toBe(false);
  });

  it('should honour a caller-supplied structural reason', () => {
    const outcome = classifyRestockFailure(new Error('boom'), 'adapter-unresolved');

    expect(outcome.restockBlockedReason).toBe('adapter-unresolved');
  });
});

describe('blockedBeforeMaster', () => {
  it('should never count toward restocked', () => {
    const outcome = blockedBeforeMaster('no-inventory-master', 'nothing configured');

    expect(outcome.countsTowardRestocked).toBe(false);
    expect(outcome.restockedBy).toBeNull();
    expect(outcome.restockState).toBe('blocked');
  });
});
