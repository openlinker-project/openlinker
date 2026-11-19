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
  it('should keep every open step and open at the asked one', () => {
    const walk = tourStepsForRequest(instances, undefined, { stepId: 'b', connectionId: 'c2' });
    expect(walk.startIndex).toBe(2);
    expect(walk.steps).toHaveLength(3);
  });

  it('should list every open step when no step is asked for', () => {
    expect(tourStepsForRequest(instances, undefined, {}).steps).toHaveLength(3);
  });

  it('should skip steps that are already done', () => {
    const state = {
      enabled: true,
      cursor: null,
      user: [],
      installation: [{ itemKey: 'a:c1', status: 'done' }],
    } as unknown as ReleaseState;
    expect(tourStepsForRequest(instances, state, {}).steps.map((s) => s.stepId)).toEqual(['b', 'b']);
  });

  const showcases = [
    {
      itemKey: 'showcase-s',
      showcase: {
        id: 's',
        introducedIn: '0.20.0',
        appliesWhen: () => true,
        stops: [
          { routePattern: 'orders', target: 'a' },
          { routePattern: 'orders', target: 'b' },
        ],
      },
    },
  ];

  it('should append unseen showcases as one entry per stop after the setup steps', () => {
    const walk = tourStepsForRequest(instances, undefined, {}, showcases);
    expect(walk.steps).toHaveLength(5);
    expect(walk.steps[3].showcase).toEqual({ itemKey: 'showcase-s', stopIndex: 0, stopCount: 2 });
  });

  it('should walk only the asked showcase for a replay', () => {
    const walk = tourStepsForRequest(instances, undefined, { showcaseId: 's' }, showcases);
    expect(walk.steps.map((s) => s.stepId)).toEqual(['s', 's']);
    expect(walk.startIndex).toBe(0);
  });
});
