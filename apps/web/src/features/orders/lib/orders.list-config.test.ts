import { describe, expect, it } from 'vitest';
import { filterEntries, resolveNonViewParams } from '../../saved-views';
import {
  ORDER_SORT_CODEC,
  ORDER_STORED_QUERY_CODEC,
  ORDER_VIEW_IDS,
  createOrdersListRegistry,
  type OrdersListConfigInput,
} from './orders.list-config';
import { ORDER_FILTER_PARAMS } from './order-filter-descriptors';

const noCell = (): null => null;

function registry() {
  const names = Object.fromEntries(Object.values(ORDER_VIEW_IDS).map((id) => [id, id])) as OrdersListConfigInput['viewNames'];
  const labels = new Proxy({}, { get: (_target, key) => String(key) }) as OrdersListConfigInput['labels'];
  const sortLabels = new Proxy({}, { get: (_target, key) => String(key) }) as OrdersListConfigInput['sortLabels'];
  const cells = new Proxy({}, { get: () => noCell }) as OrdersListConfigInput['cells'];
  return createOrdersListRegistry({ labels, viewNames: names, sortLabels, cells });
}

/** The names `ListOrdersQueryDto` validates a stored query against (apps/api orders DTO). */
const DTO_KEYS = new Set([
  'sourceConnectionId', 'createdFrom', 'createdTo', 'health', 'sort', 'dir', 'slaState', 'fulfillmentState',
  'hold', 'salesDocumentBlocked', 'destinationRoutingBlocked', 'waitingInOpenLinker', 'onPackBench', 'phase',
  'taxRateConflict', 'attention', 'withGift', 'withBundle', 'giftNotAdded', 'giftShopRejected', 'attentionReason',
  'paymentNotSent', 'packed', 'hasBuyerNote', 'hidden', 'openReturn', 'tag', 'untagged',
]);

describe('orders list config', () => {
  it('should keep the column ids the preset migration copied', () => {
    expect(registry().columns.map((column) => column.id)).toEqual(['customer', 'channel', 'status', 'shipment', 'money']);
  });

  describe('sort codec', () => {
    it('should read sort and dir as the list URLs already spell them', () => {
      expect(ORDER_SORT_CODEC.parse(new URLSearchParams('sort=total&dir=asc'))).toEqual({ key: 'total', dir: 'asc' });
      expect(ORDER_SORT_CODEC.parse(new URLSearchParams('sort=payment'))).toEqual({ key: 'payment', dir: 'asc' });
      expect(ORDER_SORT_CODEC.parse(new URLSearchParams('dir=asc'))).toEqual({ key: 'createdAt', dir: 'asc' });
      expect(ORDER_SORT_CODEC.parse(new URLSearchParams('sort=nonsense'))).toEqual({ key: 'createdAt', dir: 'desc' });
      expect(ORDER_SORT_CODEC.parse(new URLSearchParams('health=synced'))).toBeNull();
    });

    it('should write both params and remove both for no sort', () => {
      const params = new URLSearchParams('sort=old&dir=asc&health=synced');
      ORDER_SORT_CODEC.write(params, { key: 'total', dir: 'desc' });
      expect(params.get('sort')).toBe('total');
      expect(params.get('dir')).toBe('desc');
      ORDER_SORT_CODEC.write(params, null);
      expect(params.toString()).toBe('health=synced');
    });
  });

  describe('stored query codec', () => {
    it('should store the operator-named toggles under the names the endpoint validates', () => {
      const stored = ORDER_STORED_QUERY_CODEC.encode(
        'invoicing=blocked&routing=blocked&waiting=true&packBench=true&taxRate=conflict&health=synced',
      );
      const keys = filterEntries(stored, []).map(([key]) => key);
      expect(keys.sort()).toEqual(
        ['destinationRoutingBlocked', 'health', 'onPackBench', 'salesDocumentBlocked', 'taxRateConflict', 'waitingInOpenLinker'].sort(),
      );
      expect(new URLSearchParams(stored).get('salesDocumentBlocked')).toBe('true');
    });

    it('should round-trip back to the address spelling', () => {
      const query = 'invoicing=blocked&packBench=true&taxRate=conflict';
      expect(new URLSearchParams(ORDER_STORED_QUERY_CODEC.decode(ORDER_STORED_QUERY_CODEC.encode(query))).toString()).toBe(
        new URLSearchParams(query).toString(),
      );
    });

    it('should keep an unexpected value under its own key so the endpoint refuses it by name', () => {
      expect(ORDER_STORED_QUERY_CODEC.encode('invoicing=nope')).toBe('invoicing=nope');
    });
  });

  describe('views', () => {
    it('should keep the ship-by window and the moment\'s params out of every view', () => {
      const nonView = resolveNonViewParams(registry());
      for (const key of ['due', 'dir', 'peek', 'search', 'offset', 'sort']) expect(nonView).toContain(key);
    });

    it('should declare a filter for every narrowing URL param a view may carry', () => {
      const declared = new Set(registry().filters.map((filter) => filter.key));
      const outside = new Set(['search', 'due']);
      for (const param of ORDER_FILTER_PARAMS) {
        if (!outside.has(param)) expect(declared.has(param)).toBe(true);
      }
    });

    it('should only put stored names the list endpoint accepts in a built-in view or a stored filter', () => {
      const r = registry();
      const valueOf: Record<string, string> = { invoicing: 'blocked', routing: 'blocked', taxRate: 'conflict' };
      const queries = [
        ...r.systemViews.map((view) => view.query),
        ...r.filters.map((filter) => `${filter.key}=${valueOf[filter.key] ?? 'true'}`),
      ];
      for (const query of queries) {
        const stored = ORDER_STORED_QUERY_CODEC.encode(query);
        for (const [key] of filterEntries(stored, [])) expect(DTO_KEYS.has(key)).toBe(true);
      }
    });

    it('should sort Awaiting dispatch by ship-by, soonest first, and no other built-in view', () => {
      const views = registry().systemViews;
      expect(views.find((view) => view.id === ORDER_VIEW_IDS.awaitingDispatch)?.sort).toEqual({ key: 'dispatchBy', dir: 'asc' });
      expect(views.filter((view) => view.sort !== undefined)).toHaveLength(1);
    });

    it('should offer a Sort option for every key a column header sorts by', () => {
      const r = registry();
      const options = new Set(r.sorts.map((option) => option.key));
      const keys = r.columns.flatMap((column) => [
        ...(column.parts?.flatMap((part) => (part.sort ? [part.sort] : [])) ?? []),
        ...(column.headerControls?.flatMap((control) => (control.sort ? [control.sort] : [])) ?? []),
        ...(column.sortKey ? [column.sortKey] : []),
      ]);
      for (const key of keys) expect(options.has(key)).toBe(true);
    });
  });
});
