/**
 * #3482 - the packing-stage fold for an order list row.
 *
 * The case that matters most is the REAL shape the pack bench leaves behind: a
 * parcel shut on the bench keeps `status = 'open'`, so a rule reading `status`
 * alone reported "To pack" for a packed parcel. That case is asserted first.
 */
import { FulfillmentWorkStatusValues } from './fulfillment-work-status.types';
import type { FulfillmentWorkStatus } from './fulfillment-work-status.types';
import {
  stageOfFulfillmentWork,
  summarizeOrderWork,
  type FulfillmentWorkProgress,
} from './order-work-summary.types';

const CLOSED_AT = new Date('2026-10-23T12:48:12Z');
const work = (
  status: FulfillmentWorkStatus,
  parcelClosedAt: Date | null = null,
  extra: { hasVerification?: boolean; assignedToUserId?: string | null } = {}
): FulfillmentWorkProgress => ({
  status,
  parcelClosedAt,
  hasVerification: extra.hasVerification ?? false,
  assignedToUserId: extra.assignedToUserId ?? null,
});

describe('stageOfFulfillmentWork', () => {
  it('should report packed for a bench-closed parcel whose status is still open', () => {
    expect(stageOfFulfillmentWork(work('open', CLOSED_AT))).toBe('packed');
  });

  it('should report packed for a closed parcel even while the status is in progress', () => {
    expect(stageOfFulfillmentWork(work('in_progress', CLOSED_AT))).toBe('packed');
  });

  it('should report packing while the bench is scanning and the box is still open', () => {
    // The bench writes a verification per scan and never moves `status`.
    expect(stageOfFulfillmentWork(work('open', null, { hasVerification: true }))).toBe('packing');
  });

  it('should report packed once the box is shut, whatever was scanned', () => {
    expect(stageOfFulfillmentWork(work('open', CLOSED_AT, { hasVerification: true }))).toBe(
      'packed'
    );
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

  it('should return null when every work is cancelled or incomplete', () => {
    expect(summarizeOrderWork([work('cancelled'), work('incomplete')])).toBeNull();
  });

  it('should report the stage of a single work', () => {
    expect(summarizeOrderWork([work('in_progress')])).toMatchObject({ stage: 'packing', workCount: 1 });
  });

  it('should report the earliest stage when a split order has works at different stages', () => {
    expect(summarizeOrderWork([work('open', CLOSED_AT), work('open')])).toMatchObject({
      stage: 'to-pack',
      workCount: 2,
    });
    expect(summarizeOrderWork([work('closed'), work('in_progress')])).toMatchObject({
      stage: 'packing',
      workCount: 2,
    });
  });

  it('should report packed only when every live parcel is packed', () => {
    expect(summarizeOrderWork([work('open', CLOSED_AT), work('closed')])).toMatchObject({
      stage: 'packed',
      workCount: 2,
    });
  });

  it('should not count a cancelled work towards the order', () => {
    expect(summarizeOrderWork([work('open', CLOSED_AT), work('cancelled')])).toMatchObject({
      stage: 'packed',
      workCount: 1,
    });
  });
});

describe('summarizeOrderWork - who packs it', () => {
  it('should report Unassigned as a single null assignee', () => {
    expect(summarizeOrderWork([work('open')])).toMatchObject({
      assignment: 'single',
      assignedToUserId: null,
    });
  });

  it('should report the packer when every live work is assigned to the same person', () => {
    expect(
      summarizeOrderWork([
        work('open', null, { assignedToUserId: 'user-1' }),
        work('in_progress', null, { assignedToUserId: 'user-1' }),
      ])
    ).toMatchObject({ assignment: 'single', assignedToUserId: 'user-1' });
  });

  it('should report mixed and no name when a split order has different packers', () => {
    expect(
      summarizeOrderWork([
        work('open', null, { assignedToUserId: 'user-1' }),
        work('open', null, { assignedToUserId: 'user-2' }),
      ])
    ).toMatchObject({ assignment: 'mixed', assignedToUserId: null });
  });

  it('should ignore a cancelled work when deciding the packer', () => {
    expect(
      summarizeOrderWork([
        work('open', null, { assignedToUserId: 'user-1' }),
        work('cancelled', null, { assignedToUserId: 'user-2' }),
      ])
    ).toMatchObject({ assignment: 'single', assignedToUserId: 'user-1' });
  });
});
