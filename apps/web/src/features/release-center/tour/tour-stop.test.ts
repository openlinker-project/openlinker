import { describe, expect, it } from 'vitest';
import { walkableSteps } from './tour-stop';

const steps = [
  { stepId: 'packing-owner', connectionId: 'c1', importance: 'optional' as const },
  { stepId: 'shipping-routing', connectionId: 'c1', importance: 'optional' as const },
  { stepId: 'release-center-tour', connectionId: null, importance: 'optional' as const, showcase: { itemKey: 'k', stopIndex: 0, stopCount: 1 } },
];

describe('walkableSteps', () => {
  it('should drop setup steps closed to a viewer and keep showcase stops', () => {
    expect(walkableSteps(steps, false).map((s) => s.stepId)).toEqual(['release-center-tour']);
  });

  it('should keep every step for someone who can change settings', () => {
    expect(walkableSteps(steps, true)).toHaveLength(3);
  });
});
