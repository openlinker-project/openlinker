import { describe, expect, it } from 'vitest';
import { RELEASE_STEPS } from '../catalog/release-steps';
import { completedStepItemKeys } from './completed-steps';
import { releaseStepItemKey } from './release-state-merge';

const A = '3f2a1c9e-0000-4000-8000-00000000000a';
const B = '3f2a1c9e-0000-4000-8000-00000000000b';
const UPDATE_KEY = ['connections', 'update'];

function inpost(id: string, config: Record<string, unknown>) {
  return { id, platformType: 'inpost', capabilities: [], config };
}

describe('completedStepItemKeys', () => {
  it('should complete the step for the saved connection only when the key changed', () => {
    const keys = completedStepItemKeys(
      {
        mutationKey: UPDATE_KEY,
        variables: {
          connectionId: A,
          input: { config: { shipping: { notifyMarketplaceOnLabelPurchase: true } } },
        },
        meta: undefined,
        before: inpost(A, { shipping: { notifyMarketplaceOnLabelPurchase: false } }),
      },
      RELEASE_STEPS,
      '0.21.0'
    );
    expect(keys).toEqual([releaseStepItemKey('inpost-notify-buyer', A)]);
    expect(keys).not.toContain(releaseStepItemKey('inpost-notify-buyer', B));
  });

  it('should not complete after an unrelated save of a connection that already has the key', () => {
    const config = { shipping: { notifyMarketplaceOnLabelPurchase: true }, other: 1 };
    const keys = completedStepItemKeys(
      {
        mutationKey: UPDATE_KEY,
        variables: { connectionId: A, input: { config: { ...config, other: 2 } } },
        meta: undefined,
        before: inpost(A, config),
      },
      RELEASE_STEPS,
      '0.21.0'
    );
    expect(keys).toEqual([]);
  });

  it('should ignore steps newer than the app version', () => {
    const keys = completedStepItemKeys(
      {
        mutationKey: UPDATE_KEY,
        variables: {
          connectionId: A,
          input: { config: { shipping: { notifyMarketplaceOnLabelPurchase: true } } },
        },
        meta: undefined,
        before: inpost(A, {}),
      },
      RELEASE_STEPS,
      '0.20.0'
    );
    expect(keys).toEqual([]);
  });
});
