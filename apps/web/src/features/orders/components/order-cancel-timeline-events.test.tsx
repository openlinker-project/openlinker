import { describe, expect, it } from 'vitest';

import { buildOrderCancelTimelineEvents } from './order-cancel-timeline-events';
import type { OrderChangeView } from '../api/order-cancel.types';
import type { OrderRefundRecord } from '../api/order-refund.types';

const CANCEL: OrderChangeView = {
  id: 'change_cancel',
  kind: 'order.cancel_request',
  status: 'confirmed',
  open: false,
  requestedAt: '2026-09-25T11:02:00.000Z',
  confirmedAt: '2026-09-25T11:03:00.000Z',
  declinedReason: null,
  payload: { cancelRequest: { reason: 'buyer-request', note: 'Called us' }, correction: null },
};

const CORRECTION: OrderChangeView = {
  id: 'change_corr',
  kind: 'order.cancel_correction',
  status: 'requested',
  open: true,
  requestedAt: '2026-09-25T11:03:00.000Z',
  confirmedAt: null,
  declinedReason: null,
  payload: {
    cancelRequest: null,
    correction: { invoiceRecordId: 'inv_1', documentNumber: 'FV/1', currency: 'PLN', lines: [] },
  },
};

const REFUND: OrderRefundRecord = {
  id: 'ref_1',
  internalOrderId: 'o1',
  amount: '348.99',
  currency: 'PLN',
  reason: 'other',
  note: null,
  recordedAt: '2026-09-26T09:00:00.000Z',
  createdAt: '2026-09-26T09:00:00.000Z',
};

const BASE = { sourceName: 'Allegro', refunds: [] as OrderRefundRecord[] };

describe('buildOrderCancelTimelineEvents (#3541)', () => {
  it('should build the history from the persisted changes alone, with no session result', () => {
    const events = buildOrderCancelTimelineEvents({ ...BASE, changes: [CORRECTION, CANCEL] });

    expect(events.map((event) => event.title)).toEqual([
      'Cancellation requested: Buyer asked to cancel',
      'Order cancelled',
      'Correction invoice drafted for FV/1',
      'Refund not confirmed yet',
    ]);
  });

  it('should end an unrefunded cancelled order with an UNDATED "Refund not confirmed yet"', () => {
    const events = buildOrderCancelTimelineEvents({ ...BASE, changes: [CANCEL] });
    const last = events.at(-1);

    expect(last?.title).toBe('Refund not confirmed yet');
    expect(last?.timestamp).toBeNull();
    expect(events.filter((event) => event.timestamp === null)).toHaveLength(1);
  });

  it('should replace the undated entry with a dated confirmation once a refund is recorded', () => {
    const events = buildOrderCancelTimelineEvents({ ...BASE, changes: [CANCEL], refunds: [REFUND] });

    expect(events.some((event) => event.title === 'Refund not confirmed yet')).toBe(false);
    expect(events.at(-1)).toMatchObject({
      title: 'Refund confirmed: 348.99 PLN',
      timestamp: '2026-09-26T09:00:00.000Z',
    });
  });

  it('should not claim the order was cancelled while the channel has not answered', () => {
    const events = buildOrderCancelTimelineEvents({
      ...BASE,
      changes: [{ ...CANCEL, status: 'requested', open: true, confirmedAt: null }],
    });

    expect(events).toHaveLength(1);
    expect(events[0].description).toBe('Called us');
    expect(events[0].tone).toBe('warning');
    expect(events.some((event) => event.title === 'Refund not confirmed yet')).toBe(false);
  });

  it('should render a refusal with the channel reason', () => {
    const events = buildOrderCancelTimelineEvents({
      ...BASE,
      changes: [{ ...CANCEL, status: 'declined', confirmedAt: null, declinedReason: 'Order is paid out' }],
    });

    expect(events.at(-1)).toMatchObject({ tone: 'error', description: 'Order is paid out' });
  });

  it('should add the session-only rows for the matching change', () => {
    const events = buildOrderCancelTimelineEvents({
      ...BASE,
      changes: [CANCEL],
      sessionResult: {
        status: 'cancelled',
        changeId: 'change_cancel',
        cancelledAt: null,
        participants: [],
        otherParticipantsRelayFailed: false,
        voidedShipmentIds: ['s1'],
        cancelledWorkIds: [],
        stockRestoreEnqueued: true,
        correctionProposal: null,
        correctionUnavailableReason: null,
      },
    });

    expect(events.map((event) => event.title)).toEqual(
      expect.arrayContaining(['Shipping label voided', 'Reserved stock released']),
    );
  });
});
