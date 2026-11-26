/**
 * Shoper order source - order-sync-start contract (#4265)
 *
 * An in-memory `/orders` collection that understands what this adapter sends:
 * `order` sorts on `order_id` and `status_date`, the flat `filters[order_id][>]`
 * key, the JSON `filters` object (`order_id`, `date`, `status_date`), and 1-based
 * paging. Dates are naive shop-local wall clocks, as on the wire.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/order-source/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { ShoperOrderRow } from '../../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperOrderReferenceProvider } from '../../../shop-context/shoper-order-reference.provider';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { shoperAdapterManifest } from '../../../../shoper-plugin';
import { ShoperOrderSourceAdapter } from '../shoper-order-source.adapter';
import { WARSAW, buildOrderRow } from './shoper-order-source-test-data';

type Bounds = Record<string, string>;

function buildSubject(): OrderSourceStartSubject {
  let rows: ShoperOrderRow[] = [];
  let down = false;
  let seq = 0;
  const add = (date: string): string => {
    seq += 1;
    // status_date equals the placement date: nothing has changed since it was placed.
    rows.push(buildOrderRow({ order_id: String(seq), date, status_date: date }));
    return String(seq);
  };

  const get = (_path: string, query: Record<string, string | number>): Promise<unknown> => {
    if (down) return Promise.reject(new Error('socket hang up'));
    const json =
      typeof query.filters === 'string'
        ? (JSON.parse(query.filters) as Record<string, Bounds>)
        : {};
    const after = query['filters[order_id][>]'];
    const id = (r: ShoperOrderRow): number => Number(r.order_id);
    let out = rows.filter((r) => {
      const idBounds = json.order_id ?? {};
      const dateBounds = json.date ?? {};
      const statusBounds = json.status_date ?? {};
      return (
        (after === undefined || id(r) > Number(after)) &&
        (idBounds['>'] === undefined || id(r) > Number(idBounds['>'])) &&
        (idBounds['<'] === undefined || id(r) < Number(idBounds['<'])) &&
        (dateBounds['>='] === undefined || String(r.date) >= dateBounds['>=']) &&
        (dateBounds['<='] === undefined || String(r.date) <= dateBounds['<=']) &&
        (statusBounds['>='] === undefined || String(r.status_date) >= statusBounds['>='])
      );
    });
    const order = String(query.order ?? 'order_id ASC');
    out = [...out].sort((a, b) => {
      const asc = order.endsWith('ASC');
      const key = order.startsWith('status_date')
        ? String(a.status_date).localeCompare(String(b.status_date)) || id(a) - id(b)
        : id(a) - id(b);
      return asc ? key : -key;
    });
    const limit = Number(query.limit);
    const page = Number(query.page ?? 1);
    const list = out.slice((page - 1) * limit, page * limit);
    return Promise.resolve({
      status: 200,
      data: {
        count: String(out.length),
        pages: Math.max(1, Math.ceil(out.length / limit)),
        page,
        list,
      },
    });
  };

  const reference = { getStatus: jest.fn().mockResolvedValue({ type: 3, labels: ['x'] }) };
  const shopContext = { get: jest.fn().mockResolvedValue({ timezone: WARSAW }) };
  return {
    adapter: new ShoperOrderSourceAdapter(
      { get } as unknown as ShoperHttpClient,
      reference as unknown as ShoperOrderReferenceProvider,
      shopContext as unknown as ShoperShopContextProvider,
      { id: 'conn-1' } as Connection
    ),
    manifest: shoperAdapterManifest,
    scenario: {
      emptyShop: () => {
        rows = [];
      },
      shopWithOrders: () => {
        rows = [];
        return Promise.resolve({
          existingIds: [add('2025-01-01 10:00:00'), add('2025-01-02 10:00:00')],
        });
      },
      placeNewerOrder: () => Promise.resolve(add('2025-02-01 10:00:00')),
      breakTransport: () => {
        down = true;
      },
      fixTransport: () => {
        down = false;
      },
      dateBetween: () => {
        rows = [];
        const olderIds = [add('2025-01-01 10:00:00'), add('2025-01-02 10:00:00')];
        const newerIds = [add('2025-03-01 10:00:00'), add('2025-03-02 10:00:00')];
        return Promise.resolve({ date: '2025-02-01', olderIds, newerIds });
      },
      windowOrders: () => {
        rows = [];
        const ids = [1, 2, 3, 4, 5].map((d) => add(`2025-04-0${d} 10:00:00`));
        return Promise.resolve({ from: '2025-04-01', to: '2025-04-30', ids });
      },
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'ShoperOrderSourceAdapter' });
