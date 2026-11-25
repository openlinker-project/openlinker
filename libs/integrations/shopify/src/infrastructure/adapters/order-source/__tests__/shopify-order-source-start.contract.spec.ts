/**
 * Shopify order source - order-sync-start contract (#4265)
 *
 * An in-memory Admin GraphQL `orders` connection that understands the three
 * filters this adapter sends (`updated_at:>=`, `created_at:>=`, `created_at:<=`),
 * both sort keys, and `after` cursors, plus the shop time zone and app scope
 * reads. Orders are dated days in the past because the live feed deliberately
 * ignores anything newer than its settle window.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-source/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { OrderStatusWriteback } from '@openlinker/core/orders';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import { shopifyAdapterManifest } from '../../../../shopify-plugin';
import { ShopifyOrderSourceAdapter } from '../shopify-order-source.adapter';

interface Row {
  n: number;
  createdAt: string;
  updatedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = new Date(Date.now() - 20 * DAY_MS);
/** `YYYY-MM-DD` of day `offset` after the scenario's base day (20 days ago). */
const dayStr = (offset: number): string =>
  new Date(BASE.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
const at = (offset: number): string => `${dayStr(offset)}T10:00:00.000Z`;

const filterValue = (query: string | null | undefined, pattern: RegExp): string | undefined =>
  query === null || query === undefined ? undefined : pattern.exec(query)?.[1];

function buildSubject(): OrderSourceStartSubject {
  let rows: Row[] = [];
  let down = false;
  let seq = 0;
  const add = (iso: string): string => {
    seq += 1;
    rows.push({ n: seq, createdAt: iso, updatedAt: iso });
    return String(seq);
  };

  const page = (
    sorted: Row[],
    vars: { first: number; after?: string | null }
  ): { orders: unknown } => {
    let offset = 0;
    if (vars.after !== null && vars.after !== undefined) {
      offset = Number(vars.after);
      if (!Number.isInteger(offset)) {
        // Shopify answers a cursor it did not issue with a GraphQL error.
        throw new Error('Invalid cursor');
      }
    }
    const slice = sorted.slice(offset, offset + vars.first);
    const end = offset + slice.length;
    return {
      orders: {
        nodes: slice.map((r) => ({
          id: `gid://shopify/Order/${r.n}`,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          cancelledAt: null,
        })),
        pageInfo: { hasNextPage: end < sorted.length, endCursor: String(end) },
      },
    };
  };

  const client = {
    query: (document: string, variables: Record<string, unknown> = {}): Promise<unknown> => {
      if (down) return Promise.reject(new Error('fetch failed'));
      if (document.includes('OlOrderSourceTimeZone'))
        return Promise.resolve({ shop: { ianaTimezone: 'UTC' } });
      if (document.includes('OlOrderSourceScopes')) {
        return Promise.resolve({
          currentAppInstallation: { accessScopes: [{ handle: 'read_all_orders' }] },
        });
      }
      const query = variables.query as string | null | undefined;
      const vars = variables as { first: number; after?: string | null; reverse?: boolean };
      if (document.includes('OlOrderFeed')) {
        const gte = filterValue(query, /updated_at:>='([^']+)'/);
        let out = rows.filter(
          (r) => gte === undefined || r.updatedAt >= new Date(gte).toISOString()
        );
        out = [...out].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.n - b.n);
        if (vars.reverse === true) out.reverse();
        return Promise.resolve(page(out, vars));
      }
      if (document.includes('OlOrderWindow')) {
        const gte = filterValue(query, /created_at:>='([^']+)'/);
        const lte = filterValue(query, /created_at:<='([^']+)'/);
        let out = rows.filter(
          (r) =>
            (gte === undefined || r.createdAt >= gte) && (lte === undefined || r.createdAt <= lte)
        );
        out = [...out].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.n - b.n);
        if (vars.reverse === true) out.reverse();
        try {
          return Promise.resolve(page(out, vars));
        } catch (error) {
          return Promise.reject(error);
        }
      }
      return Promise.reject(new Error('unexpected query'));
    },
  };

  const adapter = new ShopifyOrderSourceAdapter(
    client as unknown as ShopifyGraphqlClient,
    'dev.myshopify.com',
    { id: 'c1' } as Connection,
    { write: jest.fn() } as OrderStatusWriteback
  );
  return {
    adapter,
    manifest: shopifyAdapterManifest,
    scenario: {
      emptyShop: () => {
        rows = [];
      },
      shopWithOrders: () => {
        rows = [];
        return Promise.resolve({ existingIds: [add(at(1)), add(at(2))] });
      },
      placeNewerOrder: () => Promise.resolve(add(at(5))),
      breakTransport: () => {
        down = true;
      },
      fixTransport: () => {
        down = false;
      },
      dateBetween: () => {
        rows = [];
        const olderIds = [add(at(1)), add(at(2))];
        const newerIds = [add(at(8)), add(at(9))];
        return Promise.resolve({ date: dayStr(5), olderIds, newerIds });
      },
      windowOrders: () => {
        rows = [];
        const ids = [3, 4, 5, 6, 7].map((d) => add(at(d)));
        return Promise.resolve({ from: dayStr(3), to: dayStr(10), ids });
      },
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'ShopifyOrderSourceAdapter' });
