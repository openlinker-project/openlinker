/**
 * #3482 - the view-model for an order OpenLinker handles itself.
 *
 * The assertions that matter are the two "renders nothing" cases: an unrecognised
 * stage and an unrecognised held reason must NOT become a confident wrong label.
 */
import { describe, expect, it } from 'vitest';

import type { FulfillmentBlockReasonValue, OrderHandledInOpenLinker } from '../api/orders.types';
import {
  deriveWaiting,
  derivePackingStage,
  derivePackerLabel,
  isHandledInOpenLinker,
  needsPackerNames,
  showsPackingStage,
} from './handled-in-openlinker';
import { WAITING_REASON_COPY } from './handled-in-openlinker.copy';

describe('derivePackingStage', () => {
  it.each([
    ['to-pack', 'To pack'],
    ['packing', 'Packing'],
    ['packed', 'Packed'],
  ] as const)('should label %s as %s', (stage, label) => {
    expect(derivePackingStage({ stage, workCount: 1 })?.label).toBe(label);
  });

  it('should return null when OpenLinker found no live work', () => {
    expect(derivePackingStage(undefined)).toBeNull();
  });

  it('should return null for a stage this build does not know', () => {
    const newer = { stage: 'consolidating', workCount: 1 } as unknown as OrderHandledInOpenLinker;
    expect(derivePackingStage(newer)).toBeNull();
  });
});

describe('deriveWaiting', () => {
  it.each([
    ['routing-refused', 'Waiting: stock', 'warning'],
    ['routing-no-shipping-address', 'Waiting: address', 'warning'],
    ['routing-failed', 'Waiting: routing', 'error'],
  ] as const)('should read %s from the persisted reason as "%s"', (reason, label, tone) => {
    const view = deriveWaiting({ fulfillmentBlockReason: reason });
    expect(view?.label).toBe(label);
    expect(view?.tone).toBe(tone);
  });

  it('should keep the routing error red and every other waiting reason a warning', () => {
    expect(WAITING_REASON_COPY['routing-failed'].tone).toBe('error');
    expect(WAITING_REASON_COPY['routing-refused'].tone).toBe('warning');
  });

  it('should return null when nothing holds the order', () => {
    expect(deriveWaiting({ fulfillmentBlockReason: null })).toBeNull();
    expect(deriveWaiting({})).toBeNull();
  });

  it.each(['routing-in-doubt', 'routing-contended', 'routing-already-live-elsewhere'] as const)(
    'should render no badge for the transient guard %s',
    (reason) => {
      expect(deriveWaiting({ fulfillmentBlockReason: reason })).toBeNull();
    }
  );

  it('should return null for a reason written by a newer release', () => {
    // Not a member of the mirror: the shape an unknown persisted value takes at runtime.
    const unknown = 'routing-teleported' as FulfillmentBlockReasonValue;
    expect(deriveWaiting({ fulfillmentBlockReason: unknown })).toBeNull();
  });
});

describe('isHandledInOpenLinker', () => {
  it('should be true only when live work was found', () => {
    expect(isHandledInOpenLinker({ handledInOpenLinker: { stage: 'packed', workCount: 1 } })).toBe(
      true
    );
    expect(isHandledInOpenLinker({})).toBe(false);
  });
});

describe('showsPackingStage', () => {
  it('should hide the marker for a packed order that already shows the Packed tick', () => {
    expect(
      showsPackingStage({
        handledInOpenLinker: { stage: 'packed', workCount: 1 },
        packedAt: '2026-10-23T12:44:14.998Z',
      })
    ).toBe(false);
  });

  it('should show the marker for a packed order with no packedAt to fall back on', () => {
    expect(
      showsPackingStage({ handledInOpenLinker: { stage: 'packed', workCount: 1 }, packedAt: null })
    ).toBe(true);
  });

  it('should show the marker for a stage before packed even when packedAt is set', () => {
    expect(
      showsPackingStage({
        handledInOpenLinker: { stage: 'to-pack', workCount: 2 },
        packedAt: '2026-10-23T12:44:14.998Z',
      })
    ).toBe(true);
  });

  it('should show nothing when OpenLinker found no live work', () => {
    expect(showsPackingStage({ packedAt: null })).toBe(false);
  });
});

describe('derivePackerLabel (#3482)', () => {
  const names = new Map([['user-1', 'kasia']]);
  const work = (
    stage: 'to-pack' | 'packing' | 'packed',
    assignment: 'single' | 'mixed' | undefined,
    assignedToUserId: string | null
  ) => ({ stage, workCount: 1, assignment, assignedToUserId });

  it('should say Unassigned when nobody packs it', () => {
    expect(derivePackerLabel(work('to-pack', 'single', null), names)).toBe('Unassigned');
  });

  it("should show the packer's name for To pack and Packing", () => {
    expect(derivePackerLabel(work('to-pack', 'single', 'user-1'), names)).toBe('kasia');
    expect(derivePackerLabel(work('packing', 'single', 'user-1'), names)).toBe('kasia');
  });

  it('should say Assigned, never a raw id, when the name cannot be resolved', () => {
    expect(derivePackerLabel(work('to-pack', 'single', 'user-gone'), names)).toBe('Assigned');
  });

  it('should say Several packers for a split order with different packers', () => {
    expect(derivePackerLabel(work('to-pack', 'mixed', null), names)).toBe('Several packers');
  });

  it('should say nothing once the parcel is packed, or for an older response', () => {
    expect(derivePackerLabel(work('packed', 'single', 'user-1'), names)).toBeNull();
    expect(derivePackerLabel(work('to-pack', undefined, null), names)).toBeNull();
    expect(derivePackerLabel(undefined, names)).toBeNull();
  });
});

describe('needsPackerNames (#3482)', () => {
  it('should be true only when a row has an assigned, unpacked work', () => {
    const assigned = { stage: 'to-pack' as const, workCount: 1, assignment: 'single' as const, assignedToUserId: 'u' };
    expect(needsPackerNames([{ handledInOpenLinker: assigned }])).toBe(true);
    expect(needsPackerNames([{ handledInOpenLinker: { ...assigned, assignedToUserId: null } }])).toBe(false);
    expect(needsPackerNames([{ handledInOpenLinker: { ...assigned, stage: 'packed' } }])).toBe(false);
    expect(needsPackerNames([{}])).toBe(false);
  });
});
