/**
 * Amazon order source - order-sync-start contract (#4262)
 *
 * An in-memory `searchOrders` that understands what this adapter sends:
 * `lastUpdatedAfter`, `createdAfter` / `createdBefore` and an offset-shaped
 * `paginationToken`, over a clock the scenario moves. Amazon's overlap means a
 * feed read is repeatable, so every order the scenario places is older than the
 * clock's next window edge and a second read comes back empty.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/order-source/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';

import { amazonAdapterManifest } from '../../../../amazon-plugin';
import type { AmazonSpApiClient } from '../../../http/amazon-spapi-client';
import { amazonFbmOrder } from '../../../__tests__/amazon-order.fixture';
import { AmazonOrderSourceAdapter } from '../amazon-order-source.adapter';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface FakeOrder {
  readonly id: string;
  readonly created: number;
  readonly updated: number;
}

function buildSubject(): OrderSourceStartSubject {
  let clock = Date.parse('2026-11-25T12:00:00.000Z');
  let orders: FakeOrder[] = [];
  let down = false;
  let seq = 0;
  const add = (created: number, updated: number = created): string => {
    seq += 1;
    orders.push({ id: `A-${seq}`, created, updated });
    return `A-${seq}`;
  };

  const get = (_path: string, query: Record<string, unknown>): Promise<unknown> => {
    if (down) return Promise.reject(new Error('socket hang up'));
    const at = (key: string): number | undefined =>
      typeof query[key] === 'string' ? Date.parse(query[key] as string) : undefined;
    const updatedAfter = at('lastUpdatedAfter');
    const createdAfter = at('createdAfter');
    const createdBefore = at('createdBefore');
    const matched = orders
      .filter(
        (o) =>
          (updatedAfter === undefined || o.updated >= updatedAfter) &&
          (createdAfter === undefined || o.created >= createdAfter) &&
          (createdBefore === undefined || o.created <= createdBefore),
      )
      .sort((a, b) => a.created - b.created);
    const size = Number(query.maxResultsPerPage ?? 100);
    const offset = typeof query.paginationToken === 'string' ? Number(query.paginationToken) : 0;
    const page = matched.slice(offset, offset + size);
    const more = offset + size < matched.length;
    return Promise.resolve({
      status: 200,
      requestId: 'r',
      data: {
        orders: page.map((o) =>
          amazonFbmOrder({
            orderId: o.id,
            createdTime: new Date(o.created).toISOString(),
            lastUpdatedTime: new Date(o.updated).toISOString(),
          }),
        ),
        ...(more ? { pagination: { nextToken: String(offset + size) } } : {}),
        ...(updatedAfter !== undefined ? { lastUpdatedBefore: new Date(clock).toISOString() } : {}),
      },
    });
  };

  const client = { get, post: jest.fn() } as unknown as AmazonSpApiClient;
  return {
    adapter: new AmazonOrderSourceAdapter(
      'conn-amazon-1',
      client,
      { region: 'eu', environment: 'production', marketplaceIds: ['A1PA6795UKMFR9'] },
      () => new Date(clock),
    ),
    manifest: amazonAdapterManifest,
    scenario: {
      emptyShop: () => {
        orders = [];
      },
      shopWithOrders: () => {
        orders = [];
        return Promise.resolve({ existingIds: [add(clock - 3 * DAY), add(clock - 2 * DAY)] });
      },
      placeNewerOrder: () => {
        clock += HOUR;
        return Promise.resolve(add(clock - 30 * 60 * 1000));
      },
      breakTransport: () => {
        down = true;
      },
      fixTransport: () => {
        down = false;
      },
      dateBetween: () => {
        orders = [];
        const olderIds = [add(clock - 60 * DAY), add(clock - 59 * DAY)];
        const newerIds = [add(clock - 20 * DAY), add(clock - 19 * DAY)];
        return Promise.resolve({
          date: new Date(clock - 40 * DAY).toISOString().slice(0, 10),
          olderIds,
          newerIds,
        });
      },
      windowOrders: () => {
        orders = [];
        const base = Date.parse('2026-04-01T10:00:00.000Z');
        // Spread over two 30-day slices so the walk crosses a slice boundary.
        const ids = [0, 1, 2, 31, 32].map((d) => add(base + d * DAY));
        return Promise.resolve({ from: '2026-04-01', to: '2026-06-30', ids });
      },
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'AmazonOrderSourceAdapter' });
