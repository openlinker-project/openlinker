/**
 * In-memory order source for the start-contract spec (#4265)
 *
 * A conforming adapter plus a switch per way of being wrong. Each flag breaks
 * exactly one rule so the spec can assert that exactly the matching case fails.
 *
 * @module libs/core/src/orders/testing/__tests__
 */
/* eslint-disable @typescript-eslint/require-await -- in-memory fakes implement Promise-returning ports */
import { OrderSyncStartUnavailableError } from '../../domain/exceptions/order-sync-start-unavailable.error';
import type { OrderImportDirection } from '../../domain/ports/capabilities/order-window-reader.capability';
import type { OrderFeedInput, OrderFeedItem, OrderFeedOutput } from '../../domain/types/order-feed.types';
import type { IncomingOrder } from '../../domain/types/incoming-order.types';
import type {
  OrderSourceStartScenario,
  OrderSourceStartSubject,
} from '../order-source-start-contract.suite';

export type Flaw =
  | 'empty-head-unreadable'
  | 'swallow-head-failure'
  | 'head-feed-includes-older'
  | 'feed-duplicates-newer'
  | 'untyped-date-error'
  | 'date-ignored'
  | 'window-repeats-an-order'
  | 'window-never-ends'
  | 'window-done-mismatch'
  | 'window-restarts-on-bad-cursor'
  | 'window-ignores-bad-from';

interface ShopOrder {
  readonly id: string;
  readonly seq: number;
  readonly date: string;
}

export class FakeShop {
  orders: ShopOrder[] = [];
  broken = false;
  private seq = 0;

  add(date: string): string {
    this.seq += 1;
    const id = `o${this.seq}`;
    this.orders.push({ id, seq: this.seq, date });
    return id;
  }
}

function item(order: ShopOrder): OrderFeedItem {
  return {
    externalOrderId: order.id,
    eventType: 'created',
    occurredAt: `${order.date}T10:00:00Z`,
    eventKey: `${order.id}:created`,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class FakeOrderSource {
  constructor(
    private readonly shop: FakeShop,
    private readonly flaws: ReadonlySet<Flaw> = new Set(),
  ) {}

  private guard(): void {
    if (this.shop.broken) throw new Error('transport down');
  }

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    this.guard();
    const from = input.fromCursor === null ? 0 : Number(input.fromCursor);
    if (Number.isNaN(from)) throw new Error('malformed cursor');
    const floor = this.flaws.has('head-feed-includes-older') && from > 0 ? from - 1 : from;
    const rows = this.shop.orders.filter((o) => o.seq > floor).slice(0, input.limit);
    const items = rows.map(item);
    if (this.flaws.has('feed-duplicates-newer') && items.length > 0) items.push(items[0]);
    const last = rows[rows.length - 1];
    return { items, nextCursor: last ? String(last.seq) : null };
  }

  async getOrder(): Promise<IncomingOrder> {
    throw new Error('not used by the contract');
  }

  async headCursor(): Promise<string | null> {
    if (this.shop.broken) {
      if (this.flaws.has('swallow-head-failure')) return null;
      throw new Error('transport down');
    }
    const last = this.shop.orders[this.shop.orders.length - 1];
    if (!last) return this.flaws.has('empty-head-unreadable') ? 'unreadable' : null;
    return String(last.seq);
  }

  async cursorForDate(date: string): Promise<string> {
    this.guard();
    if (!DAY.test(date)) {
      throw this.flaws.has('untyped-date-error')
        ? new Error('bad date')
        : new OrderSyncStartUnavailableError(`unusable date ${date}`);
    }
    if (this.flaws.has('date-ignored')) return '0';
    const older = this.shop.orders.filter((o) => o.date < date);
    return String(older.length > 0 ? older[older.length - 1].seq : 0);
  }

  async listOrdersInWindow(input: {
    from?: string;
    to?: string;
    direction: OrderImportDirection;
    cursor: string | null;
    limit: number;
  }): Promise<{ items: OrderFeedItem[]; nextCursor: string | null; done: boolean }> {
    this.guard();
    if (input.from !== undefined && !DAY.test(input.from) && !this.flaws.has('window-ignores-bad-from')) {
      throw new OrderSyncStartUnavailableError(`unusable from ${input.from}`);
    }
    let offset = 0;
    if (input.cursor !== null) {
      offset = Number(input.cursor);
      if (!Number.isInteger(offset)) {
        if (!this.flaws.has('window-restarts-on-bad-cursor')) {
          throw new OrderSyncStartUnavailableError('malformed cursor');
        }
        offset = 0;
      }
    }
    const from = input.from !== undefined && DAY.test(input.from) ? input.from : undefined;
    let rows = this.shop.orders.filter(
      (o) => (from === undefined || o.date >= from) && (input.to === undefined || o.date <= input.to),
    );
    if (input.direction === 'newest-first') rows = [...rows].reverse();
    const start = this.flaws.has('window-repeats-an-order') && offset > 0 ? offset - 1 : offset;
    const page = rows.slice(start, start + input.limit);
    const end = start + page.length;
    const exhausted = end >= rows.length;
    if (this.flaws.has('window-never-ends')) {
      return { items: page.map(item), nextCursor: String(end + 1), done: false };
    }
    if (this.flaws.has('window-done-mismatch')) {
      return { items: page.map(item), nextCursor: exhausted ? null : String(end), done: !exhausted };
    }
    return { items: page.map(item), nextCursor: exhausted ? null : String(end), done: exhausted };
  }
}

/** A subject over a fresh shop. `declare` lets a spec lie in the manifest. */
export function makeSubject(
  options: {
    flaws?: Flaw[];
    manifest?: OrderSourceStartSubject['manifest'];
    adapter?: (shop: FakeShop, flaws: ReadonlySet<Flaw>) => OrderSourceStartSubject['adapter'];
    noDateScenario?: boolean;
  } = {},
): OrderSourceStartSubject {
  const shop = new FakeShop();
  const flaws = new Set(options.flaws ?? []);
  const scenario: OrderSourceStartScenario = {
    emptyShop: () => {
      shop.orders = [];
    },
    shopWithOrders: async () => {
      shop.orders = [];
      return { existingIds: [shop.add('2025-01-01'), shop.add('2025-01-02')] };
    },
    placeNewerOrder: async () => shop.add('2025-02-01'),
    breakTransport: () => {
      shop.broken = true;
    },
    fixTransport: () => {
      shop.broken = false;
    },
    ...(options.noDateScenario
      ? {}
      : {
          dateBetween: async (): Promise<{
            date: string;
            olderIds: string[];
            newerIds: string[];
          }> => {
            shop.orders = [];
            const olderIds = [shop.add('2025-01-01'), shop.add('2025-01-02')];
            const newerIds = [shop.add('2025-03-01'), shop.add('2025-03-02')];
            return { date: '2025-02-01', olderIds, newerIds };
          },
        }),
    windowOrders: async () => {
      shop.orders = [];
      const ids = ['2025-04-01', '2025-04-02', '2025-04-03', '2025-04-04', '2025-04-05'].map((d) =>
        shop.add(d),
      );
      return { from: '2025-04-01', to: '2025-04-30', ids };
    },
  };
  const adapter = options.adapter
    ? options.adapter(shop, flaws)
    : (new FakeOrderSource(shop, flaws) as unknown as OrderSourceStartSubject['adapter']);
  return {
    adapter,
    manifest: options.manifest ?? { orderSyncStartModes: ['now', 'from', 'all'], orderWindowImport: true },
    scenario,
  };
}
