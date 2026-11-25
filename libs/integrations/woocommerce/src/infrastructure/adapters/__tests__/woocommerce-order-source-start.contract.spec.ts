/**
 * WooCommerce order source - order-sync-start contract (#4265)
 *
 * An in-memory `/wp-json/wc/v3/orders` that honours `modified_after` (exclusive),
 * `orderby=modified` and `per_page`, which is everything the adapter sends.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { WooCommerceOrderSourceAdapter } from '../woocommerce-order-source.adapter';
import { woocommerceAdapterManifest } from '../../../woocommerce-plugin';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import type { WooCommerceOrder } from '../order-source/woocommerce-order.types';

function buildSubject(): OrderSourceStartSubject {
  let orders: WooCommerceOrder[] = [];
  let down = false;
  let nextId = 0;
  const add = (modifiedGmt: string): string => {
    nextId += 1;
    orders.push({
      id: nextId,
      status: 'processing',
      date_created: modifiedGmt,
      date_created_gmt: modifiedGmt,
      date_modified: modifiedGmt,
      date_modified_gmt: modifiedGmt,
    } as unknown as WooCommerceOrder);
    return String(nextId);
  };

  const http: IWooCommerceHttpClient = {
    get: ((_path: string, params: Record<string, string | number | boolean> = {}) => {
      if (down) return Promise.reject(new Error('socket hang up'));
      const after =
        params.modified_after === undefined
          ? null
          : new Date(String(params.modified_after)).getTime();
      let rows = orders.filter(
        (o) => after === null || new Date(`${o.date_modified_gmt}Z`).getTime() > after
      );
      rows = [...rows].sort((a, b) => a.date_modified_gmt.localeCompare(b.date_modified_gmt));
      if (params.order === 'desc') rows.reverse();
      return Promise.resolve(rows.slice(0, Number(params.per_page ?? 10)));
    }) as IWooCommerceHttpClient['get'],
  } as IWooCommerceHttpClient;

  const connection = {
    id: 'conn-wc',
    platformType: 'woocommerce',
    config: {},
  } as unknown as Connection;
  return {
    adapter: new WooCommerceOrderSourceAdapter(http, connection),
    manifest: woocommerceAdapterManifest,
    scenario: {
      emptyShop: () => {
        orders = [];
      },
      shopWithOrders: () => {
        orders = [];
        return Promise.resolve({
          existingIds: [add('2025-01-01T10:00:00'), add('2025-01-02T10:00:00')],
        });
      },
      placeNewerOrder: () => Promise.resolve(add('2025-02-01T10:00:00')),
      breakTransport: () => {
        down = true;
      },
      fixTransport: () => {
        down = false;
      },
      dateBetween: () => {
        orders = [];
        const olderIds = [add('2025-01-01T10:00:00'), add('2025-01-02T10:00:00')];
        const newerIds = [add('2025-03-01T10:00:00'), add('2025-03-02T10:00:00')];
        return Promise.resolve({ date: '2025-02-01', olderIds, newerIds });
      },
    },
  };
}

runOrderSourceStartContract(buildSubject, {
  subject: 'WooCommerceOrderSourceAdapter',
  knownDeviations: {
    // FINDING (#4265): headCursor() is the newest order's modification time minus
    // SEED_SAFETY_MARGIN_MS (2 s, WC's modified_after is exclusive with second
    // granularity), so the newest order that existed at head time is read again
    // by the first poll. Ingestion is idempotent, so it costs one re-import of
    // the latest order, not history; the margin is deliberate.
    'head-then-feed-reads-only-newer': 'seed margin re-reads the newest existing order',
  },
});
