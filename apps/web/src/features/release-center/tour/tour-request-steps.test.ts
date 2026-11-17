import { describe, expect, it } from 'vitest';
import type { StepInstance } from '../lib/release-notifications';
import type { ReleaseState } from '../api/release-state.types';
import { tourStepsForRequest } from './tour-request-steps';

function instance(id: string, connectionId: string | null): StepInstance {
  return {
    step: { id } as StepInstance['step'],
    connectionId,
    connectionName: null,
    itemKey: connectionId ? `${id}:${connectionId}` : id,
    importance: 'optional',
  };
}

const instances = [instance('a', 'c1'), instance('b', 'c1'), instance('b', 'c2')];

describe('tourStepsForRequest', () => {
  it('should start from the asked step when it is open', () => {
    const steps = tourStepsForRequest(instances, undefined, { stepId: 'b', connectionId: 'c2' });
    expect(steps.map((s) => `${s.stepId}:${s.connectionId}`)).toEqual(['b:c2']);
  });

  it('should list every open step when no step is asked for', () => {
    expect(tourStepsForRequest(instances, undefined, {})).toHaveLength(3);
  });

  it('should skip steps that are already done', () => {
    const state = {
      enabled: true,
      cursor: null,
      user: [],
      installation: [{ itemKey: 'a:c1', status: 'done' }],
    } as unknown as ReleaseState;
    expect(tourStepsForRequest(instances, state, {}).map((s) => s.stepId)).toEqual(['b', 'b']);
  });
});
