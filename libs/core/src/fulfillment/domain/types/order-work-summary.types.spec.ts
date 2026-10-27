/**
 * #3482 - the packing-stage fold for an order list row.
 *
 * The case that matters most is the REAL shape the pack bench leaves behind: a
 * parcel shut on the bench keeps `status = 'open'`, so a rule reading `status`
 * alone reported "To pack" for a packed parcel. That case is asserted first.
 */
import { FulfillmentWorkStatusValues } from './fulfillment-work-status.types';
import type { FulfillmentWorkStatus } from './fulfillment-work-status.types';
import { stageOfFulfillmentWork, summarizeOrderWork } from './order-work-summary.types';

const CLOSED_AT = new Date('2026-10-23T12:48:12Z');
const work = (status: FulfillmentWorkStatus, parcelClosedAt: Date | null = null) => ({
  status,
  parcelClosedAt,
});

describe('stageOfFulfillmentWork', () => {
  it('should report packed for a bench-closed parcel whose status is still open', () => {
    expect(stageOfFulfillmentWork(work('open', CLOSED_AT))).toBe('packed');
  });

  it('should report packed for a closed parcel even while the status is in progress', () => {
    expect(stageOfFulfillmentWork(work('in_progress', CLOSED_AT))).toBe('packed');
  });

  it.each([
    ['open', 'to-pack'],
    ['scheduled', 'to-pack'],
    ['on_hold', 'to-pack'],
    ['in_progress', 'packing'],
    ['closed', 'packed'],
  ] as const)('should map an open parcel with status %s to %s', (status, stage) => {
    expect(stageOfFulfillmentWork(work(status))).toBe(stage);
  });

  it.each(['cancelled', 'incomplete'] as const)(
    'should take no part in the flow when the status is %s, even with a closed parcel',
    (status) => {
      expect(stageOfFulfillmentWork(work(status))).toBeNull();
      expect(stageOfFulfillmentWork(work(status, CLOSED_AT))).toBeNull();
    }
  );

  it('should take no part in the flow when the status is outside the declared union', () => {
    // The column is plain text cast at the repository boundary, so this is
    // reachable at runtime; it must be `null`, never `undefined`.
    const unknown = { status: 'archived' as FulfillmentWorkStatus, parcelClosedAt: null };
    expect(stageOfFulfillmentWork(unknown)).toBeNull();
  });

  it('should answer for every status the work axis declares', () => {
    for (const status of FulfillmentWorkStatusValues) {
      expect(() => stageOfFulfillmentWork(work(status))).not.toThrow();
    }
  });
});

describe('summarizeOrderWork', () => {
  it('should return null when the order has no work', () => {
    expect(summarizeOrderWork([])).toBeNull();
  });

  it('should not count a work with an unrecognised status towards workCount', () => {
    const unknown = { status: 'archived' as FulfillmentWorkStatus, parcelClosedAt: null };
    expect(summarizeOrderWork([work('open'), unknown])).toEqual({ stage: 'to-pack', workCount: 1 });
  });

  it('should return null when every work is cancelled or incomplete', () => {
    expect(summarizeOrderWork([work('cancelled'), work('incomplete')])).toBeNull();
  });

  it('should report the stage of a single work', () => {
    expect(summarizeOrderWork([work('in_progress')])).toEqual({ stage: 'packing', workCount: 1 });
  });

  it('should report the earliest stage when a split order has works at different stages', () => {
    expect(summarizeOrderWork([work('open', CLOSED_AT), work('open')])).toEqual({
      stage: 'to-pack',
      workCount: 2,
    });
    expect(summarizeOrderWork([work('closed'), work('in_progress')])).toEqual({
      stage: 'packing',
      workCount: 2,
    });
  });

  it('should report packed only when every live parcel is packed', () => {
    expect(summarizeOrderWork([work('open', CLOSED_AT), work('closed')])).toEqual({
      stage: 'packed',
      workCount: 2,
    });
  });

  it('should not count a cancelled work towards the order', () => {
    expect(summarizeOrderWork([work('open', CLOSED_AT), work('cancelled')])).toEqual({
      stage: 'packed',
      workCount: 1,
    });
  });
});
