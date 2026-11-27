/**
 * Allegro order source - order-sync-start contract (#4265)
 *
 * An in-memory seller account: an order-event journal (`/order/events`,
 * `/order/event-stats`) and a checkout-forms list (`/order/checkout-forms`),
 * the two reads the adapter uses for the live feed and for window imports.
 * Allegro has no date start, so only the head and window cases apply.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';
import { Connection } from '@openlinker/core/identifier-mapping';
import { AllegroOrderSourceAdapter } from '../allegro-order-source.adapter';
import { allegroAdapterManifest } from '../../../allegro-plugin';
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';

interface Order {
  id: string;
  boughtAt: string;
}

function buildSubject(): OrderSourceStartSubject {
  let orders: Order[] = [];
  let down = false;
  let seq = 0;
  const add = (boughtAt: string): string => {
    seq += 1;
    const id = `cf-${seq}`;
    orders.push({ id, boughtAt });
    return id;
  };
  // Journal event ids are zero-padded so the adapter's string comparison orders them.
  const eventId = (n: number): string => String(n).padStart(8, '0');

  const get = (
    path: string,
    options?: { queryParams?: Record<string, string | number> }
  ): Promise<unknown> => {
    if (down) return Promise.reject(new Error('socket hang up'));
    const q = options?.queryParams ?? {};
    if (path === '/order/event-stats') {
      const last = orders[orders.length - 1];
      return Promise.resolve({
        data: { latestEvent: last ? { id: eventId(orders.length) } : undefined },
      });
    }
    if (path === '/order/events') {
      const from = q.from === undefined ? 0 : Number(q.from);
      const events = orders
        .map((o, i) => ({
          id: eventId(i + 1),
          type: 'BOUGHT',
          occurredAt: o.boughtAt,
          order: { checkoutForm: { id: o.id } },
        }))
        .filter((e) => Number(e.id) > from)
        .slice(0, Number(q.limit ?? 100));
      return Promise.resolve({ data: { events, lastEventId: events[events.length - 1]?.id } });
    }
    if (path === '/order/checkout-forms') {
      const gte = q['lineItems.boughtAt.gte'] as string | undefined;
      const lte = q['lineItems.boughtAt.lte'] as string | undefined;
      let rows = orders.filter(
        (o) => (gte === undefined || o.boughtAt >= gte) && (lte === undefined || o.boughtAt <= lte)
      );
      rows = [...rows].sort((a, b) => a.boughtAt.localeCompare(b.boughtAt));
      if (String(q.sort).startsWith('-')) rows.reverse();
      const offset = Number(q.offset ?? 0);
      const page = rows.slice(offset, offset + Number(q.limit));
      return Promise.resolve({
        data: {
          checkoutForms: page.map((o) => ({ id: o.id, lineItems: [{ boughtAt: o.boughtAt }] })),
        },
      });
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  };

  const connection = new Connection(
    'c1',
    'allegro',
    'A',
    'active',
    {},
    'ref',
    new Date(),
    new Date(),
    undefined,
    ['OrderSource']
  );
  return {
    adapter: new AllegroOrderSourceAdapter(
      'c1',
      { get } as unknown as IAllegroHttpClient,
      connection
    ),
    manifest: allegroAdapterManifest,
    scenario: {
      emptyShop: () => {
        orders = [];
      },
      shopWithOrders: () => {
        orders = [];
        return Promise.resolve({
          existingIds: [add('2025-01-01T10:00:00.000Z'), add('2025-01-02T10:00:00.000Z')],
        });
      },
      placeNewerOrder: () => Promise.resolve(add('2025-02-01T10:00:00.000Z')),
      breakTransport: () => {
        down = true;
      },
      fixTransport: () => {
        down = false;
      },
      windowOrders: () => {
        orders = [];
        const ids = [1, 2, 3, 4, 5].map((d) => add(`2025-04-0${d}T10:00:00.000Z`));
        return Promise.resolve({ from: '2025-04-01', to: '2025-04-30', ids });
      },
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'AllegroOrderSourceAdapter' });
