/**
 * Fulfilment dispatch-timeout pure rules — unit spec (#2712)
 *
 * @module libs/core/src/fulfillment/domain/types
 */
import {
  deriveAcceptanceAttention,
  describeFulfillmentDispatchTimeout,
  FULFILLMENT_DISPATCH_TIMEOUT_IS_BLOCKING,
  FULFILLMENT_DISPATCH_TIMEOUT_REASON,
  resolveFulfillmentDispatchTimeoutMs,
} from './fulfillment-dispatch-timeout.types';
import type { FulfillmentWork } from './fulfillment-work.types';
import type { FulfillmentRequestStatus } from './fulfillment-request-status.types';
import type { FulfillmentWorkStatus } from './fulfillment-work-status.types';

const HOUR_MS = 60 * 60 * 1000;

const work = (
  id: string,
  status: FulfillmentWorkStatus,
  requestStatus: FulfillmentRequestStatus
): FulfillmentWork =>
  ({ id, orderId: 'ol_order_1', status, requestStatus }) as unknown as FulfillmentWork;

describe('resolveFulfillmentDispatchTimeoutMs (#2712)', () => {
  it('should default to two hours when no value is configured', () => {
    expect(resolveFulfillmentDispatchTimeoutMs(undefined)).toBe(2 * HOUR_MS);
  });

  it('should honour a configured value inside the bounds', () => {
    expect(resolveFulfillmentDispatchTimeoutMs(String(6 * HOUR_MS))).toBe(6 * HOUR_MS);
  });

  it('should clamp UP to the floor, so a mistyped value cannot reap live dispatches', () => {
    // The floor is the safety bound: below it the sweep starts reaping work a
    // healthy holder is still answering, and a reap frees the work to re-route.
    expect(resolveFulfillmentDispatchTimeoutMs('1000')).toBe(5 * 60 * 1000);
  });

  it('should clamp DOWN to the ceiling', () => {
    expect(resolveFulfillmentDispatchTimeoutMs(String(400 * 24 * HOUR_MS))).toBe(
      7 * 24 * HOUR_MS
    );
  });

  it.each([['not-a-number'], [''], ['0'], ['-5'], ['NaN'], ['Infinity']])(
    'should fall back to the default rather than throw on %p',
    (raw) => {
      // A malformed env var must never wedge a sweep — the
      // `resolveSweepLockTtlMs` idiom.
      expect(resolveFulfillmentDispatchTimeoutMs(raw)).toBe(2 * HOUR_MS);
    }
  );
});

describe('describeFulfillmentDispatchTimeout (#2712, AC3)', () => {
  it('should render the SAME number the cutoff is computed from, in minutes under two hours', () => {
    const timeoutMs = 45 * 60 * 1000;
    expect(describeFulfillmentDispatchTimeout(timeoutMs)).toContain('45 minutes');
  });

  it('should render hours at and above two hours', () => {
    expect(describeFulfillmentDispatchTimeout(6 * HOUR_MS)).toContain('6 hours');
  });

  it('should describe exactly the resolved default, so reported === enforced', () => {
    // #2229's rule: an operator reads this sentence off the rejection row and
    // must be reading the number that actually reaped the work. One resolver,
    // one description — a drift here would be a false statement, not a typo.
    const resolved = resolveFulfillmentDispatchTimeoutMs(undefined);
    expect(describeFulfillmentDispatchTimeout(resolved)).toContain('2 hours');
  });
});

describe('the timeout rejection vocabulary (#2712)', () => {
  it('should namespace the reason so OL is never mistaken for the holder', () => {
    // `FulfillmentWorkRejection.reason` is the REJECTER's own vocabulary. OL is
    // the rejecter here by inference, so a bare 'timeout' would be
    // indistinguishable from a holder that happens to use that word.
    expect(FULFILLMENT_DISPATCH_TIMEOUT_REASON).toBe('openlinker:dispatch-timeout');
    expect(FULFILLMENT_DISPATCH_TIMEOUT_REASON.startsWith('openlinker:')).toBe(true);
  });

  it('should NEVER be blocking — a silence is our inference, not the holder’s declaration', () => {
    // The single most load-bearing decision in #2712. A blocking timeout would
    // permanently exclude the only shipped executor after a transient outage,
    // with no in-product remedy.
    expect(FULFILLMENT_DISPATCH_TIMEOUT_IS_BLOCKING).toBe(false);
  });
});

describe('deriveAcceptanceAttention (#2712, A3-X)', () => {
  it('should report nothing when the order holds no work', () => {
    expect(deriveAcceptanceAttention([])).toEqual({ kind: 'none' });
  });

  it('should report nothing when every work is accepted', () => {
    expect(deriveAcceptanceAttention([work('w1', 'open', 'accepted')])).toEqual({ kind: 'none' });
  });

  it('should report A3-X for a live REJECTED work', () => {
    const outcome = deriveAcceptanceAttention([work('w1', 'open', 'rejected')]);
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'fulfillment-unaccepted' });
  });

  it('should cover a HOLDER rejection as well as a timeout, because A3-X means both', () => {
    // A3-X's descriptor reads "every candidate rejected OR timed out", so the
    // derivation keys on the negotiation state rather than on the cause. A
    // timeout-only rule would report a holder-rejected work as fine.
    const outcome = deriveAcceptanceAttention([work('w1', 'open', 'rejected')]);
    expect(outcome.kind).toBe('blocked');
  });

  it('should IGNORE a terminal work, whatever its negotiation axis says', () => {
    // Cancelled/closed/incomplete work is not outstanding; the execution axis
    // decides whether anything is left to do.
    for (const terminal of ['closed', 'cancelled', 'incomplete'] as const) {
      expect(deriveAcceptanceAttention([work('w1', terminal, 'rejected')])).toEqual({
        kind: 'none',
      });
    }
  });

  it('should stay BLOCKED on a split order when one sibling is accepted and one is stuck', () => {
    // The split-safety property. `omsAttention` is keyed (order, producer), so
    // a per-work verdict would let the accepted parcel clear the stuck one's
    // flag. Reading the whole order makes that unrepresentable.
    const outcome = deriveAcceptanceAttention([
      work('w1', 'open', 'accepted'),
      work('w2', 'open', 'rejected'),
    ]);
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'fulfillment-unaccepted' });
  });

  it('should carry ids and counts only, never a connection name or an address', () => {
    // `AuthorityAttentionEntry.detail` is rendered verbatim to an operator and
    // is required to be PII-free.
    const outcome = deriveAcceptanceAttention([work('w1', 'open', 'rejected')]);
    if (outcome.kind !== 'blocked') throw new Error('expected a blocked outcome');
    expect(outcome.detail).toBe('1 fulfilment work object(s) have no holder');
    expect(outcome.subjectRef).toBe('w1');
  });

  it('should never return indeterminate — it is total over its input', () => {
    // Only a caller that FAILED to read the works may report `indeterminate`.
    expect(deriveAcceptanceAttention([]).kind).not.toBe('indeterminate');
    expect(deriveAcceptanceAttention([work('w1', 'open', 'rejected')]).kind).not.toBe(
      'indeterminate'
    );
  });
});
