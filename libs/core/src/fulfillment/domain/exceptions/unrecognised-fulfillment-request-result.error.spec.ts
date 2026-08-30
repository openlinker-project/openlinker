import type { FulfillmentRequestResult } from '../types/fulfillment-execution.types';
import {
  assertFulfillmentRequestResultRecognised,
  UnrecognisedFulfillmentRequestResultError,
} from './unrecognised-fulfillment-request-result.error';

describe('assertFulfillmentRequestResultRecognised', () => {
  const accepted: FulfillmentRequestResult = {
    status: 'accepted',
    externalWorkId: 'WMS-42',
    acceptedAt: null,
  };

  const rejected: FulfillmentRequestResult = {
    status: 'rejected',
    reason: 'no-capacity',
    blocking: true,
    detail: null,
  };

  it('should pass an accepted result', () => {
    expect(() => assertFulfillmentRequestResultRecognised(accepted)).not.toThrow();
  });

  it('should pass a rejected result, which is an expected outcome and not an error', () => {
    // A rejection is consumable — the caller re-sources — so unlike
    // `assertRoutingPlanResolved`'s `pending` arm it must never throw here.
    expect(() => assertFulfillmentRequestResultRecognised(rejected)).not.toThrow();
  });

  it('should refuse a status this build has no reading for', () => {
    const fromAnOlderOrNewerPlugin = { status: 'queued' } as unknown as FulfillmentRequestResult;

    expect(() => assertFulfillmentRequestResultRecognised(fromAnOlderOrNewerPlugin)).toThrow(
      UnrecognisedFulfillmentRequestResultError,
    );
  });

  it('should carry the offending status so an operator can name the vocabulary that leaked', () => {
    const unknown = { status: 'awaiting_wave' } as unknown as FulfillmentRequestResult;

    try {
      assertFulfillmentRequestResultRecognised(unknown);
      throw new Error('expected the assertion to refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(UnrecognisedFulfillmentRequestResultError);
      expect((error as UnrecognisedFulfillmentRequestResultError).status).toBe('awaiting_wave');
      expect((error as Error).message).toContain('awaiting_wave');
    }
  });

  /**
   * The failure this test exists for: a guard written as `status !== 'accepted' ? treat as
   * rejected` would narrow an unknown status into the rejected arm, where `blocking` reads
   * `undefined` — falsy — so the rejecter is NOT excluded and the re-source loop runs
   * forever. Testing positively for both known values is what closes that.
   */
  it('should not silently narrow an unknown status into the rejected arm', () => {
    const unknown = { status: 'partially_accepted' } as unknown as FulfillmentRequestResult;

    let narrowedBlocking: unknown = 'never assigned';
    try {
      assertFulfillmentRequestResultRecognised(unknown);
      narrowedBlocking = (unknown as { blocking?: boolean }).blocking;
    } catch {
      // expected
    }

    expect(narrowedBlocking).toBe('never assigned');
  });

  it('should refuse a missing status rather than reading it as accepted', () => {
    const empty = {} as unknown as FulfillmentRequestResult;

    expect(() => assertFulfillmentRequestResultRecognised(empty)).toThrow(
      UnrecognisedFulfillmentRequestResultError,
    );
  });
});
