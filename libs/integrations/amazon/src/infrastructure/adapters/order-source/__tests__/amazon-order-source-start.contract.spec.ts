/**
 * Amazon order source - order-sync-start contract (#4228)
 *
 * An in-memory `searchOrders` that understands what the feed sends
 * (`lastUpdatedAfter`, `maxResultsPerPage`, `paginationToken`) and a clock
 * the scenario moves forward, so an order "placed after the head" really is
 * updated after the head's watermark. Orders are dated days in the past
 * because the "from now" head keeps a two-minute overlap.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/order-source/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';

import { amazonAdapterManifest } from '../../../../amazon-plugin';
import type { AmazonSpApiClient } from '../../../http/amazon-spapi-client';
import { amazonFbmOrder } from '../../../__tests__/amazon-order.fixture';
import { AmazonOrderSourceAdapter } from '../amazon-order-source.adapter';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIG = { region: 'eu' as const, environment: 'production' as const, marketplaceIds: ['A1PA6795UKMFR9'] };

interface Row {
  readonly orderId: string;
  readonly updated: string;
}

function buildSubject(): OrderSourceStartSubject {
  let clock = new Date('2026-11-17T12:00:00.000Z');
  let rows: Row[] = [];
  let down = false;
  let seq = 0;
  const add = (updated: Date): string => {
    seq += 1;
    const orderId = `302-0000000-${String(seq).padStart(7, '0')}`;
    rows.push({ orderId, updated: updated.toISOString() });
    return orderId;
  };
  const daysAgo = (days: number): Date => new Date(clock.getTime() - days * DAY_MS);

  const client = {
    get: (_path: string, params: Record<string, unknown>): Promise<unknown> => {
      if (down) return Promise.reject(new Error('fetch failed'));
      const after = Date.parse(String(params.lastUpdatedAfter));
      const size = Number(params.maxResultsPerPage);
      const offset = typeof params.paginationToken === 'string' ? Number(params.paginationToken) : 0;
      const matching = rows
        .filter((row) => Date.parse(row.updated) > after)
        .sort((a, b) => a.updated.localeCompare(b.updated) || a.orderId.localeCompare(b.orderId));
      const page = matching.slice(offset, offset + size);
      const end = offset + page.length;
      return Promise.resolve({
        status: 200,
        requestId: 'r',
        data: {
          orders: page.map((row) =>
            amazonFbmOrder({ orderId: row.orderId, createdTime: row.updated, lastUpdatedTime: row.updated }),
          ),
          ...(end < matching.length ? { pagination: { nextToken: String(end) } } : {}),
          lastUpdatedBefore: new Date(clock.getTime() - 2 * 60 * 1000).toISOString(),
        },
      });
    },
  };

  const adapter = new AmazonOrderSourceAdapter(
    'conn-1',
    client as unknown as AmazonSpApiClient,
    CONFIG,
    () => clock,
  );

  return {
    adapter,
    manifest: amazonAdapterManifest,
    scenario: {
      emptyShop: () => {
        rows = [];
      },
      shopWithOrders: () => {
        rows = [];
        return Promise.resolve({ existingIds: [add(daysAgo(3)), add(daysAgo(2))] });
      },
      placeNewerOrder: () => {
        clock = new Date(clock.getTime() + DAY_MS);
        return Promise.resolve(add(new Date(clock.getTime() - 60 * 60 * 1000)));
      },
      breakTransport: () => {
        down = true;
      },
      fixTransport: () => {
        down = false;
      },
      dateBetween: () => {
        rows = [];
        const olderIds = [add(daysAgo(10)), add(daysAgo(9))];
        const newerIds = [add(daysAgo(4)), add(daysAgo(3)), add(daysAgo(2))];
        return Promise.resolve({ date: daysAgo(6).toISOString().slice(0, 10), olderIds, newerIds });
      },
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'AmazonOrderSourceAdapter' });
