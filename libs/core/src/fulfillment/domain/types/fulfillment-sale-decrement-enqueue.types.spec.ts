/**
 * Sale Decrement Enqueue Intents — spec (#3453)
 */
import {
  buildSaleDecrementJobDedupeKey,
  deriveSaleDecrementEnqueueIntents,
} from './fulfillment-sale-decrement-enqueue.types';

describe('deriveSaleDecrementEnqueueIntents', () => {
  it('should derive one intent per routed work, scoped to the order source connection', () => {
    const intents = deriveSaleDecrementEnqueueIntents(
      [
        { workId: 'w-1', assignedConnectionId: 'holder-oms' },
        { workId: 'w-2', assignedConnectionId: 'holder-oms' },
      ],
      'ol_order_1',
      'conn-allegro'
    );

    expect(intents).toEqual([
      {
        workId: 'w-1',
        orderId: 'ol_order_1',
        connectionId: 'conn-allegro',
        dedupeKey: 'inventory:sale-decrement:w-1',
      },
      {
        workId: 'w-2',
        orderId: 'ol_order_1',
        connectionId: 'conn-allegro',
        dedupeKey: 'inventory:sale-decrement:w-2',
      },
    ]);
  });

  // The units are sold whoever packs them — skipping holder-less work would
  // leave the master's stock high, the oversell this closes.
  it('should include a work that carries no holder', () => {
    const intents = deriveSaleDecrementEnqueueIntents(
      [{ workId: 'w-1', assignedConnectionId: null }],
      'ol_order_1',
      'conn-allegro'
    );

    expect(intents.map((intent) => intent.workId)).toEqual(['w-1']);
  });

  it('should derive nothing when there is no routed work', () => {
    expect(deriveSaleDecrementEnqueueIntents([], 'ol_order_1', 'conn-allegro')).toEqual([]);
  });
});

describe('buildSaleDecrementJobDedupeKey', () => {
  // Its own namespace, distinct from the dispatch key for the same work.
  it('should not collide with the dispatch dedupe key for the same work', () => {
    expect(buildSaleDecrementJobDedupeKey('w-1')).toBe('inventory:sale-decrement:w-1');
    expect(buildSaleDecrementJobDedupeKey('w-1')).not.toBe('fulfillment:dispatch:w-1');
  });
});
