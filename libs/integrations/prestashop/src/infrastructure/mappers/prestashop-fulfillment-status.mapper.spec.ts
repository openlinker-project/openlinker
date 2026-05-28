/**
 * Unit specs for the PrestaShop fulfillment-status mapper (#834).
 *
 * Two layers:
 *   1. `mapToFulfillmentStatusSnapshot(order, state, trackingNumber)` —
 *      status projection + delivered-timestamp threading.
 *   2. `extractTrackingFromOrder` / `extractTrackingFromCarriers` — the
 *      tracking-resolution helpers the adapter chains lazily.
 */
import { FULFILLMENT_STATUS } from '@openlinker/core/orders';

import {
  extractTrackingFromCarriers,
  extractTrackingFromOrder,
  mapToFulfillmentStatusSnapshot,
} from './prestashop-fulfillment-status.mapper';
import type {
  PrestashopOrder,
  PrestashopOrderCarrier,
} from './prestashop.mapper.interface';
import type { PrestashopOrderState } from '../../domain/types/prestashop-options.types';

function makeOrder(overrides: Partial<PrestashopOrder> = {}): PrestashopOrder {
  return {
    id: '1',
    reference: 'REF',
    current_state: '2',
    date_upd: '2026-05-28 12:00:00',
    ...overrides,
  };
}

function makeState(overrides: Partial<PrestashopOrderState> = {}): PrestashopOrderState {
  return {
    id: '2',
    name: 'Awaiting payment',
    deleted: '0',
    ...overrides,
  };
}

function makeOrderCarrier(
  overrides: Partial<PrestashopOrderCarrier> = {},
): PrestashopOrderCarrier {
  return {
    id: '1',
    id_order: '1',
    id_carrier: '1',
    ...overrides,
  };
}

describe('mapToFulfillmentStatusSnapshot', () => {
  describe('delivered branch', () => {
    it('should return Delivered with deliveredAt = date_upd when state.delivered = 1', () => {
      const order = makeOrder({ date_upd: '2026-05-28 14:00:00' });
      const state = makeState({ delivered: '1' });

      const snapshot = mapToFulfillmentStatusSnapshot(order, state, null);

      expect(snapshot.status).toBe(FULFILLMENT_STATUS.Delivered);
      expect(snapshot.deliveredAt).toEqual(new Date('2026-05-28 14:00:00'));
    });

    it('should prefer delivered over shipped when both flags are set', () => {
      const state = makeState({ delivered: '1', shipped: '1' });

      const snapshot = mapToFulfillmentStatusSnapshot(makeOrder(), state, null);

      expect(snapshot.status).toBe(FULFILLMENT_STATUS.Delivered);
    });
  });

  describe('dispatched branch', () => {
    it('should return Dispatched when shipped = 1 and delivered != 1', () => {
      const state = makeState({ shipped: '1' });

      const snapshot = mapToFulfillmentStatusSnapshot(makeOrder(), state, null);

      expect(snapshot.status).toBe(FULFILLMENT_STATUS.Dispatched);
      // dispatchedAt threading is the sync service's job — the snapshot
      // carries only deliveredAt for delivered transitions.
      expect(snapshot.deliveredAt).toBeNull();
    });
  });

  describe('cancelled branch (regex fallback)', () => {
    it.each([
      ['Cancelled', 'Cancelled'],
      ['English cancel state', 'Cancel pending'],
      ['French annulé', 'Annulé'],
      ['Spanish anulado', 'Anulado'],
      ['Italian annullato', 'Annullato'],
      ['Portuguese cancelado', 'Cancelado'],
      ['Romanian anulat', 'Anulat'],
      ['Polish anulowano', 'Anulowano'],
      ['Czech storno', 'Storno'],
      ['German abgebrochen', 'Abgebrochen'],
      ['English rejected', 'Rejected'],
    ])('should match cancel-regex for %s ("%s")', (_label, name) => {
      const state = makeState({ name });

      const snapshot = mapToFulfillmentStatusSnapshot(makeOrder(), state, null);

      expect(snapshot.status).toBe(FULFILLMENT_STATUS.Cancelled);
    });

    it.each([
      ['Hungarian törölt', 'Törölt'],
      ['Russian Cyrillic отменён', 'Отменён'],
    ])(
      'should NOT match cancel for %s ("%s") — documented gap pending #862',
      (_label, name) => {
        const state = makeState({ name });

        const snapshot = mapToFulfillmentStatusSnapshot(makeOrder(), state, null);

        // Non-Latin-script cancellation labels miss the regex by design.
        // This test documents the gap so a future change to the cancel
        // regex is deliberate, not accidental.
        expect(snapshot.status).toBeNull();
      },
    );

    it('should match cancel against multilingual-shape `name`', () => {
      const state = makeState({
        name: {
          language: [
            { '#text': 'Awaiting payment' },
            { '#text': 'Anulowano' },
          ],
        } as unknown as PrestashopOrderState['name'],
      });

      const snapshot = mapToFulfillmentStatusSnapshot(makeOrder(), state, null);

      expect(snapshot.status).toBe(FULFILLMENT_STATUS.Cancelled);
    });
  });

  describe('null branch — OMP has not acted', () => {
    it('should return status null when no flags are set and name does not match cancel', () => {
      const state = makeState({ name: 'Awaiting payment' });

      const snapshot = mapToFulfillmentStatusSnapshot(makeOrder(), state, null);

      expect(snapshot.status).toBeNull();
      expect(snapshot.deliveredAt).toBeNull();
    });

    it('should return status null when state is null (orphaned current_state)', () => {
      const snapshot = mapToFulfillmentStatusSnapshot(makeOrder(), null, null);

      expect(snapshot.status).toBeNull();
    });
  });

  describe('tracking-number passthrough', () => {
    it('should thread the pre-resolved trackingNumber onto the snapshot verbatim', () => {
      const snapshot = mapToFulfillmentStatusSnapshot(
        makeOrder(),
        makeState({ delivered: '1' }),
        'PS-TRK-1',
      );

      expect(snapshot.trackingNumber).toBe('PS-TRK-1');
    });

    it('should pass null through when no tracking was resolved upstream', () => {
      const snapshot = mapToFulfillmentStatusSnapshot(
        makeOrder(),
        makeState({ shipped: '1' }),
        null,
      );

      expect(snapshot.trackingNumber).toBeNull();
    });
  });

  describe('boolean-flag parsing', () => {
    it.each(['1', 1, 'true'])(
      'should treat value %p as truthy on delivered',
      (truthyValue) => {
        const state = makeState({ delivered: truthyValue });

        const snapshot = mapToFulfillmentStatusSnapshot(makeOrder(), state, null);

        expect(snapshot.status).toBe(FULFILLMENT_STATUS.Delivered);
      },
    );

    it.each(['0', 0, ''])('should treat value %p as falsy on shipped', (falsyValue) => {
      const state = makeState({ shipped: falsyValue });

      const snapshot = mapToFulfillmentStatusSnapshot(makeOrder(), state, null);

      expect(snapshot.status).toBeNull();
    });
  });
});

describe('extractTrackingFromOrder', () => {
  it('should return shipping_number when present and non-empty', () => {
    expect(extractTrackingFromOrder(makeOrder({ shipping_number: 'PS-TRK-1' }))).toBe('PS-TRK-1');
  });

  it('should return null when shipping_number is absent', () => {
    expect(extractTrackingFromOrder(makeOrder())).toBeNull();
  });

  it('should return null when shipping_number is empty string', () => {
    expect(extractTrackingFromOrder(makeOrder({ shipping_number: '' }))).toBeNull();
  });

  it('should return null for non-string shipping_number (defensive narrowing)', () => {
    expect(
      extractTrackingFromOrder(makeOrder({ shipping_number: 42 as unknown as string })),
    ).toBeNull();
  });
});

describe('extractTrackingFromCarriers', () => {
  it('should return the first non-empty tracking_number across rows', () => {
    const carriers = [
      makeOrderCarrier({ id: '1', tracking_number: undefined }),
      makeOrderCarrier({ id: '2', tracking_number: 'CARRIER-TRK-2' }),
      makeOrderCarrier({ id: '3', tracking_number: 'CARRIER-TRK-3' }),
    ];

    expect(extractTrackingFromCarriers(carriers)).toBe('CARRIER-TRK-2');
  });

  it('should return null when no row has a tracking_number', () => {
    expect(extractTrackingFromCarriers([makeOrderCarrier(), makeOrderCarrier()])).toBeNull();
  });

  it('should return null for an empty rows array', () => {
    expect(extractTrackingFromCarriers([])).toBeNull();
  });
});
