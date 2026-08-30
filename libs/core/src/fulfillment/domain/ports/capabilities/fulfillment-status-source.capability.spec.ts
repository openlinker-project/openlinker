import { CoreCapabilityValues } from '@openlinker/core/integrations';

import type { FulfillmentProgressSnapshot } from '../../types/fulfillment-execution.types';
import type { FulfillmentWorkRef } from '../../types/fulfillment-work.types';
import type { FulfillmentExecutorPort } from '../fulfillment-executor.port';
import {
  isFulfillmentStatusSource,
  type FulfillmentStatusSource,
} from './fulfillment-status-source.capability';

const acceptedResult = {
  status: 'accepted',
  externalWorkId: null,
  acceptedAt: null,
} as const;

/**
 * An adapter compiled against a `libs/core` that predates this sub-capability: a complete,
 * valid `FulfillmentExecutorPort` that simply has no `getFulfillmentStatus`.
 *
 * This is the AC's "older-shaped fake adapter". It is what the probe must classify as
 * NOT a status source without throwing — ADR-055's R1 forward-compat rule.
 */
class OlderShapedExecutorAdapter implements FulfillmentExecutorPort {
  requestFulfillment(): Promise<typeof acceptedResult> {
    return Promise.resolve(acceptedResult);
  }

  requestCancellation(): Promise<typeof acceptedResult> {
    return Promise.resolve(acceptedResult);
  }
}

class PollingExecutorAdapter extends OlderShapedExecutorAdapter implements FulfillmentStatusSource {
  getFulfillmentStatus(workRef: FulfillmentWorkRef): Promise<FulfillmentProgressSnapshot> {
    return Promise.resolve({ work: workRef, externalWorkId: null, lines: [], observedAt: null });
  }
}

describe('isFulfillmentStatusSource', () => {
  it('should narrow an adapter that implements the method', () => {
    const adapter: FulfillmentExecutorPort = new PollingExecutorAdapter();

    expect(isFulfillmentStatusSource(adapter)).toBe(true);

    if (isFulfillmentStatusSource(adapter)) {
      // The narrowing is the point: this line does not compile without the guard.
      expect(typeof adapter.getFulfillmentStatus).toBe('function');
    }
  });

  it('should degrade rather than throw when an older-shaped adapter lacks the method', () => {
    const adapter: FulfillmentExecutorPort = new OlderShapedExecutorAdapter();

    expect(() => isFulfillmentStatusSource(adapter)).not.toThrow();
    expect(isFulfillmentStatusSource(adapter)).toBe(false);
  });

  it('should probe the METHOD, not manifest membership', () => {
    // An adapter that declares the capability name but ships no method is still not a status
    // source. Manifest membership and method presence are independent facts, and gating on
    // the former is what ADR-055's R1 probe rule forbids.
    const declaresButDoesNotImplement = Object.assign(new OlderShapedExecutorAdapter(), {
      supportedCapabilities: ['FulfillmentExecutor', 'FulfillmentStatusSource'],
    });

    expect(isFulfillmentStatusSource(declaresButDoesNotImplement)).toBe(false);
  });

  /**
   * The advertised-without-dispatch invariant, pinned rather than only documented.
   *
   * Adding `'FulfillmentStatusSource'` to `CoreCapabilityValues` would make it look
   * dispatchable, and a call site would then reach for
   * `getCapabilityAdapter(connectionId, 'FulfillmentStatusSource')` — which passes the
   * manifest gate and then throws a generic `Error` inside `dispatchCapability`, aborting a
   * whole `listCapabilityAdapters` listing rather than skipping one connection. The name
   * would also become writable into `enabledCapabilities`, which both connection DTOs
   * `@IsIn`-validate against that array.
   *
   * `'FulfillmentExecutor'` is asserted present in the same breath, because the two facts are
   * only meaningful together: the base port IS a dispatch name (#2403) and this sub-capability
   * is not, and a reader seeing one assertion alone would not know which side is deliberate.
   */
  it('should stay out of CoreCapabilityValues while its base port stays in', () => {
    expect(CoreCapabilityValues).toContain('FulfillmentExecutor');
    expect(CoreCapabilityValues).not.toContain('FulfillmentStatusSource');
  });

  it('should reject a non-function property of the same name', () => {
    const stringValued = Object.assign(new OlderShapedExecutorAdapter(), {
      getFulfillmentStatus: 'not-a-function',
    }) as unknown as FulfillmentExecutorPort;

    expect(isFulfillmentStatusSource(stringValued)).toBe(false);
  });
});
