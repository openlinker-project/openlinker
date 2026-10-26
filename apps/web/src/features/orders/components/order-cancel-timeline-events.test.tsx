import { describe, expect, it } from 'vitest';

import { buildOrderCancelTimelineEvents } from './order-cancel-timeline-events';
import type { CancelOrderResult } from '../api/order-cancel.types';

const BASE: CancelOrderResult = {
  status: 'cancelled',
  changeId: 'change_1',
  cancelledAt: '2026-09-25T11:02:00.000Z',
  participants: [{ connectionId: 'c1', role: 'source', effect: 'notified', detail: null }],
  otherParticipantsRelayFailed: false,
  voidedShipmentIds: ['s1'],
  cancelledWorkIds: [],
  stockRestoreEnqueued: true,
  correctionProposal: null,
  correctionUnavailableReason: null,
};

const INPUT = { reason: 'buyer-request', requestedAt: '2026-09-25T11:02:01.000Z', sourceName: 'Allegro' };

describe('buildOrderCancelTimelineEvents (#3541)', () => {
  it('should end a cancelled order with an UNDATED "Refund not confirmed yet" entry', () => {
    const events = buildOrderCancelTimelineEvents({ ...INPUT, result: BASE });
    const last = events.at(-1);

    expect(last?.title).toBe('Refund not confirmed yet');
    expect(last?.timestamp).toBeNull();
    expect(events.filter((event) => event.timestamp === null)).toHaveLength(1);
  });

  it('should never label anything a refund that happened', () => {
    const events = buildOrderCancelTimelineEvents({ ...INPUT, result: BASE });
    const titles = events.map((event) => (typeof event.title === 'string' ? event.title : ''));

    expect(titles.some((title) => /^Refunded|Refund issued|Refund confirmed$/i.test(title))).toBe(false);
  });

  it('should record the requested reason and, when pending, wait for the channel without inventing outcomes', () => {
    const events = buildOrderCancelTimelineEvents({
      ...INPUT,
      result: { ...BASE, status: 'pending', cancelledAt: null },
    });

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Cancellation requested: Buyer asked to cancel');
    expect(events[0].description).toBe('Waiting for Allegro to confirm.');
    expect(events[0].tone).toBe('warning');
  });

  it('should add the drafted correction only when a proposal came back', () => {
    const withProposal = buildOrderCancelTimelineEvents({
      ...INPUT,
      result: {
        ...BASE,
        correctionProposal: {
          changeId: 'change_1',
          invoiceRecordId: 'inv_1',
          documentNumber: 'FV/1',
          currency: 'PLN',
          lines: [],
        },
      },
    });
    const without = buildOrderCancelTimelineEvents({ ...INPUT, result: BASE });

    expect(withProposal.some((event) => String(event.title).startsWith('Correction invoice drafted for FV/1'))).toBe(true);
    expect(without.some((event) => String(event.title).startsWith('Correction invoice drafted'))).toBe(false);
  });
});
