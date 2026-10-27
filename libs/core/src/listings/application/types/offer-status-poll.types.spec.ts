/**
 * Offer Status Poll Cadence Rules Tests
 *
 * Covers the pure cadence rules both the creation poller and the status sync
 * read: resolution with defaults, the per-iteration delay, and the worst-case
 * budget the "not found means ended" guard is sized from.
 *
 * @module libs/core/src/listings/application/types
 */
import {
  offerPollDelaySeconds,
  offerPollWorstCaseMs,
  resolveOfferPollCadence,
} from './offer-status-poll.types';

describe('offer poll cadence rules', () => {
  it('should resolve the documented defaults when no key is configured', () => {
    expect(resolveOfferPollCadence(() => undefined)).toEqual({
      initialDelaySeconds: 5,
      backoffMultiplier: 2,
      maxDelaySeconds: 60,
      maxAttempts: 12,
    });
  });

  it('should take a configured key over its default', () => {
    const cadence = resolveOfferPollCadence((key) =>
      key === 'OL_ALLEGRO_OFFER_POLL_MAX_ATTEMPTS' ? 20 : undefined
    );

    expect(cadence.maxAttempts).toBe(20);
    expect(cadence.initialDelaySeconds).toBe(5);
  });

  it('should back off exponentially and clamp each delay to the maximum', () => {
    const cadence = resolveOfferPollCadence(() => undefined);

    expect(offerPollDelaySeconds(cadence, 1)).toBe(5);
    expect(offerPollDelaySeconds(cadence, 4)).toBe(40);
    expect(offerPollDelaySeconds(cadence, 5)).toBe(60);
    expect(offerPollDelaySeconds(cadence, 12)).toBe(60);
  });

  it('should put the default worst case at about nine minutes', () => {
    // 5 + 10 + 20 + 40 + 8 x 60 seconds.
    expect(offerPollWorstCaseMs(resolveOfferPollCadence(() => undefined))).toBe(555_000);
  });

  it('should lengthen the worst case when the poller is configured to wait longer', () => {
    const cadence = resolveOfferPollCadence((key) =>
      key === 'OL_ALLEGRO_OFFER_POLL_MAX_DELAY_SECONDS' ? 600 : undefined
    );

    // 5 + 10 + 20 + 40 + 80 + 160 + 320 + 5 x 600 seconds.
    expect(offerPollWorstCaseMs(cadence)).toBe(3_635_000);
  });
});
