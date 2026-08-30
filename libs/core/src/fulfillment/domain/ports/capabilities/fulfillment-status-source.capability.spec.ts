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
 * valid `FulfillmentExecutorPort` that simply has no `getWorkFulfillmentStatus`.
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
  getWorkFulfillmentStatus(workRef: FulfillmentWorkRef): Promise<FulfillmentProgressSnapshot> {
    return Promise.resolve({ work: workRef, externalWorkId: null, lines: [], observedAt: null });
  }
}

/**
 * The rename, pinned at the type level.
 *
 * `getFulfillmentStatus` is the method name `orders`' `FulfillmentStatusReader` structurally
 * probes for. This capability must never declare it, or an adapter implementing this port
 * becomes mis-narrowable by that foreign guard. Reads the interface, not a fixture.
 */
type ForeignProbeCollision = Extract<keyof FulfillmentStatusSource, 'getFulfillmentStatus'>;
const _noForeignProbeCollision: ForeignProbeCollision extends never ? true : never = true;

describe('isFulfillmentStatusSource', () => {
  it('should narrow an adapter that implements the method', () => {
    const adapter: FulfillmentExecutorPort = new PollingExecutorAdapter();

    expect(isFulfillmentStatusSource(adapter)).toBe(true);

    if (isFulfillmentStatusSource(adapter)) {
      // The narrowing is the point: this line does not compile without the guard.
      expect(typeof adapter.getWorkFulfillmentStatus).toBe('function');
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

  /**
   * The reason this method is `getWorkFulfillmentStatus` and not DESIGN §5.4's
   * `getFulfillmentStatus`.
   *
   * `orders` ships `FulfillmentStatusReader`, whose guard is a bare
   * `typeof adapter.getFulfillmentStatus === 'function'`. Under the design's original name an
   * adapter implementing THIS capability would satisfy that foreign guard — no dual-port class
   * required — and `FulfillmentStatusSyncService`
   * (`libs/core/src/shipping/application/services/fulfillment-status-sync.service.ts:293`)
   * would call it with `{ externalOrderId }` where it expects a `FulfillmentWorkRef`. The
   * ADR-046 / #2229 shape, unfixable by a comment.
   *
   * Asserted WITHOUT importing that guard: ADR-053's no-injection contract forbids
   * `@openlinker/core/orders` anywhere under this leaf, specs included, and
   * `check-no-injection-contracts.mjs` enforces it. The property that makes mis-narrowing
   * impossible is local anyway — this capability declares no method by the foreign name — so
   * it is asserted directly rather than by coupling to the thing being avoided.
   *
   * The compile-time half is authoritative and cannot be tautological: it reads the INTERFACE,
   * so renaming the method back fails `tsc` here.
   */
  it('should declare no method under the name orders FulfillmentStatusReader probes for', () => {
    const adapter: FulfillmentStatusSource = new PollingExecutorAdapter();

    expect(_noForeignProbeCollision).toBe(true);
    expect(typeof adapter.getWorkFulfillmentStatus).toBe('function');
    expect('getFulfillmentStatus' in adapter).toBe(false);
  });

  it('should reject a non-function property of the same name', () => {
    const stringValued = Object.assign(new OlderShapedExecutorAdapter(), {
      getWorkFulfillmentStatus: 'not-a-function',
    }) as unknown as FulfillmentExecutorPort;

    expect(isFulfillmentStatusSource(stringValued)).toBe(false);
  });
});
