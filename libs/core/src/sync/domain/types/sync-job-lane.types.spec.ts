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
import { SyncJobLaneValues, resolveJobScope } from './sync-job-lane.types';

describe('SyncJobLaneValues', () => {
  it('should declare exactly the four ADR-050 lanes', () => {
    expect(SyncJobLaneValues).toEqual(['realtime', 'bulk', 'fiscal', 'fan-out']);
  });
});

describe('resolveJobScope', () => {
  it('should resolve the scope to the connection id on a single-merchant install', () => {
    expect(resolveJobScope({ connectionId: 'conn-1' })).toBe('conn-1');
  });
});
