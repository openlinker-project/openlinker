/**
 * Subiekt GT order source - order-sync-start contract (#4265)
 *
 * An in-memory bridge: `GET /api/orders/feed/head` and
 * `GET /api/orders/feed?since=<ts>|<id>&limit=n`, ordered by the bridge's own
 * `(dataWystawienia, id)` watermark. Subiekt has no window read, so only the
 * head and date cases apply.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';
import { InMemoryIdentifierMappingAdapter } from '@openlinker/core/identifier-mapping/testing';
import type { LoggerPort } from '@openlinker/shared/logging';
import { SubiektOrdersBridgeClient } from '../../../bridge/subiekt-orders-bridge.client';
import { subiektAdapterManifest } from '../../../subiekt-plugin';
import { SubiektOrderSourceAdapter } from '../subiekt-order-source.adapter';

interface Zk {
  id: number;
  at: string;
}

const silent: LoggerPort = {
  log: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const cursorOf = (z: Zk): string => `${z.at}|${z.id}`;
const envelope = (data: unknown): Response =>
  new Response(JSON.stringify({ success: true, data, error: null }), { status: 200 });

function buildSubject(): OrderSourceStartSubject {
  let zks: Zk[] = [];
  let down = false;
  let seq = 0;
  const add = (day: string): string => {
    seq += 1;
    zks.push({ id: seq, at: `${day}T10:00:00.0000000` });
    return String(seq);
  };
  const sorted = (): Zk[] => [...zks].sort((a, b) => cursorOf(a).localeCompare(cursorOf(b)));

  const fetchImpl = ((input: RequestInfo | URL) => {
    if (down) return Promise.reject(new TypeError('fetch failed'));
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    );
    if (url.pathname === '/api/orders/feed/head') {
      const newest = sorted().pop();
      return Promise.resolve(envelope({ nextCursor: newest ? cursorOf(newest) : null }));
    }
    if (url.pathname === '/api/orders/feed') {
      const since = url.searchParams.get('since');
      const limit = Number(url.searchParams.get('limit'));
      const page = sorted()
        .filter((z) => since === null || cursorOf(z) > since)
        .slice(0, limit);
      const last = page[page.length - 1];
      return Promise.resolve(
        envelope({
          items: page.map((z) => ({ id: z.id, numer: `ZK ${z.id}`, dataWystawienia: z.at })),
          nextCursor: last ? cursorOf(last) : null,
        })
      );
    }
    return Promise.resolve(new Response('', { status: 404 }));
  }) as unknown as typeof fetch;

  const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', { fetchImpl });
  return {
    adapter: new SubiektOrderSourceAdapter(
      client,
      silent,
      new InMemoryIdentifierMappingAdapter(),
      'conn-1'
    ),
    manifest: subiektAdapterManifest,
    scenario: {
      emptyShop: () => {
        zks = [];
      },
      shopWithOrders: () => {
        zks = [];
        return Promise.resolve({ existingIds: [add('2025-01-01'), add('2025-01-02')] });
      },
      placeNewerOrder: () => Promise.resolve(add('2025-02-01')),
      breakTransport: () => {
        down = true;
      },
      fixTransport: () => {
        down = false;
      },
      dateBetween: () => {
        zks = [];
        const olderIds = [add('2025-01-01'), add('2025-01-02')];
        const newerIds = [add('2025-03-01'), add('2025-03-02')];
        return Promise.resolve({ date: '2025-02-01', olderIds, newerIds });
      },
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'SubiektOrderSourceAdapter' });
