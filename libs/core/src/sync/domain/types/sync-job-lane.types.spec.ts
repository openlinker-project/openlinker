/**
 * Sync Job Lane Types Spec
 *
 * Pins the ADR-050 lane vocabulary and the scope rule. The lane count is
 * asserted exactly: ADR-050's own reversal gate says a FIFTH lane appearing
 * means the axis is wrong, so a change here must cite the ADR, not slip
 * through as a refactor.
 *
 * @module libs/core/src/sync/domain/types
 */
import {
  HOOK_SCOPE_SUFFIX,
  HOOK_SYNC_JOB_TYPES,
  SyncJobLaneValues,
  isHookScope,
  hookScopeClass,
  resolveJobScope,
} from './sync-job-lane.types';

describe('SyncJobLaneValues', () => {
  it('should declare exactly the four ADR-050 lanes', () => {
    expect(SyncJobLaneValues).toEqual(['realtime', 'bulk', 'fiscal', 'fan-out']);
  });
});

describe('resolveJobScope', () => {
  it('should resolve the scope to the connection id for every non-hook job type', () => {
    expect(resolveJobScope({ connectionId: 'conn-1', jobType: 'marketplace.order.sync' })).toBe(
      'conn-1'
    );
    expect(resolveJobScope({ connectionId: 'conn-1', jobType: 'master.product.syncFromSweep' })).toBe(
      'conn-1'
    );
  });

  it('should give webhook product and inventory syncs their own hook-sync class scope', () => {
    const product = resolveJobScope({
      connectionId: 'conn-1',
      jobType: 'master.product.syncByExternalId',
    });
    const inventory = resolveJobScope({
      connectionId: 'conn-1',
      jobType: 'master.inventory.syncByExternalId',
    });
    expect(product).toBe(`conn-1${HOOK_SCOPE_SUFFIX}`);
    expect(inventory).toBe('conn-1:hook-sync-inventory');
    expect(product).not.toBe(inventory);
    expect(hookScopeClass(product)).toBe('product');
    expect(hookScopeClass(inventory)).toBe('inventory');
    expect(isHookScope(product) && isHookScope(inventory)).toBe(true);
    expect(HOOK_SYNC_JOB_TYPES).toHaveLength(2);
  });

  it('should not report a bare connection id as a hook scope', () => {
    expect(isHookScope('conn-1')).toBe(false);
  });
});
