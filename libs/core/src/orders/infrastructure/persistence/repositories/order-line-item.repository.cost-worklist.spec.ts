/**
 * OrderLineItemRepository - cost work list query shape (#3588)
 *
 * Unit-level: a recording query builder proves the tab predicates, the sort,
 * the 30-day sales aggregate scope and - the one that matters for safety - that
 * the search text reaches SQL only as a bound parameter. The figures themselves
 * are proved against real Postgres in `cost-worklist.int-spec.ts`.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import type { OrderLineItemOrmEntity } from '../entities/order-line-item.orm-entity';
import { OrderLineItemRepository } from './order-line-item.repository';

type Call = { method: string; args: unknown[] };

function recordingBuilder(raw: { many?: unknown[]; one?: unknown } = {}): {
  qb: unknown;
  calls: Call[];
} {
  const calls: Call[] = [];
  const qb: unknown = new Proxy(
    {},
    {
      get: (_target, method: string) => {
        if (method === 'getQuery') return () => '(SELECT sales)';
        if (method === 'getParameters') return () => ({ reportingCurrency: 'PLN' });
        if (method === 'getRawMany') return () => Promise.resolve(raw.many ?? []);
        if (method === 'getRawOne') return () => Promise.resolve(raw.one);
        return (...args: unknown[]) => {
          calls.push({ method, args });
          return qb;
        };
      },
    }
  );
  return { qb, calls };
}

const window = { from: new Date('2026-09-30T00:00:00Z'), to: new Date('2026-10-30T00:00:00Z') };

function build(raw: { many?: unknown[]; one?: unknown } = {}): {
  repository: OrderLineItemRepository;
  outer: Call[];
  inner: Call[];
} {
  const outer = recordingBuilder(raw);
  const inner = recordingBuilder();
  const orm = {
    createQueryBuilder: () => inner.qb,
    manager: { createQueryBuilder: () => outer.qb },
  } as unknown as Repository<OrderLineItemOrmEntity>;
  return { repository: new OrderLineItemRepository(orm), outer: outer.calls, inner: inner.calls };
}

const wheres = (calls: Call[]): string[] =>
  calls.filter((c) => c.method === 'andWhere' || c.method === 'where').map((c) => String(c.args[0]));

describe('OrderLineItemRepository cost work list', () => {
  const base = { limit: 20, offset: 0 };

  it('should require no cost AND sales in the window for the sold tab', async () => {
    const { repository, outer } = build();
    await repository.findCostWorklistRows({ ...base, tab: 'sold' }, window, 'PLN');

    const sql = wheres(outer);
    expect(sql).toContain('pv."netUnitCost" IS NULL');
    expect(sql).toContain('COALESCE(s."net_sales", 0) > 0');
    expect(sql).toContain('pv."isStale" = false');
  });

  it('should require only no cost for the all tab, and a cost for has-cost', async () => {
    const all = build();
    await all.repository.findCostWorklistRows({ ...base, tab: 'all' }, window, 'PLN');
    expect(wheres(all.outer)).toContain('pv."netUnitCost" IS NULL');
    expect(wheres(all.outer)).not.toContain('COALESCE(s."net_sales", 0) > 0');

    const has = build();
    await has.repository.findCostWorklistRows({ ...base, tab: 'has-cost' }, window, 'PLN');
    expect(wheres(has.outer)).toContain('pv."netUnitCost" IS NOT NULL');
    expect(wheres(has.outer)).not.toContain('pv."netUnitCost" IS NULL');
  });

  it('should sort by net sales then sku, and has-cost by costUpdatedAt newest first', async () => {
    const sold = build();
    await sold.repository.findCostWorklistRows({ ...base, tab: 'sold' }, window, 'PLN');
    const soldOrder = sold.outer.filter((c) => c.method === 'orderBy' || c.method === 'addOrderBy');
    expect(soldOrder.map((c) => c.args[0])).toEqual(['net_sales', 'pv."sku"', 'pv."id"']);

    const has = build();
    await has.repository.findCostWorklistRows({ ...base, tab: 'has-cost' }, window, 'PLN');
    const hasOrder = has.outer.filter((c) => c.method === 'orderBy');
    expect(hasOrder[0].args).toEqual(['pv."costUpdatedAt"', 'DESC', 'NULLS LAST']);
  });

  it('should page with limit and offset', async () => {
    const { repository, outer } = build();
    await repository.findCostWorklistRows({ tab: 'all', limit: 7, offset: 14 }, window, 'PLN');
    expect(outer.find((c) => c.method === 'limit')?.args).toEqual([7]);
    expect(outer.find((c) => c.method === 'offset')?.args).toEqual([14]);
  });

  it('should pass the search text only as a bound, escaped parameter', async () => {
    const { repository, outer } = build();
    const hostile = "x'; DROP TABLE products; -- 100%_";
    await repository.findCostWorklistRows({ ...base, tab: 'all', q: hostile }, window, 'PLN');

    const searchCall = outer.find((c) => String(c.args[0]).includes('ILIKE'));
    expect(searchCall).toBeDefined();
    expect(String(searchCall?.args[0])).toBe('(p."name" ILIKE :worklistQ OR pv."sku" ILIKE :worklistQ)');
    expect(searchCall?.args[1]).toEqual({
      worklistQ: "%x'; DROP TABLE products; -- 100\\%\\_%",
    });
    expect(JSON.stringify(outer.map((c) => c.args[0]))).not.toContain('DROP TABLE');
  });

  it('should ignore a blank search', async () => {
    const { repository, outer } = build();
    await repository.findCostWorklistRows({ ...base, tab: 'all', q: '   ' }, window, 'PLN');
    expect(wheres(outer).some((w) => w.includes('ILIKE'))).toBe(false);
  });

  it('should scope the sales aggregate to the channel and require a sale there', async () => {
    const { repository, outer, inner } = build();
    await repository.findCostWorklistRows(
      { ...base, tab: 'all', channel: 'conn-1' },
      window,
      'PLN'
    );

    expect(wheres(outer)).toContain('s."variant_id" IS NOT NULL');
    const channelScope = inner.find((c) => String(c.args[0]).includes('sourceConnectionId'));
    expect(channelScope?.args[1]).toEqual({ salesConnectionId: 'conn-1' });
    const from = inner.find((c) => String(c.args[0]).includes(':salesFrom'));
    expect(from?.args[1]).toEqual({ salesFrom: window.from });
  });

  it('should map raw rows, defaulting a missing connection list to empty', async () => {
    const { repository } = build({
      many: [
        {
          variant_id: 'v1',
          product_id: 'p1',
          product_name: 'Cup',
          sku: 'CUP-1',
          attributes: { colour: 'black' },
          net_unit_cost: null,
          cost_currency: null,
          cost_updated_at: null,
          net_sales: '12.5',
          units: '3',
          connection_ids: null,
        },
      ],
    });

    const [row] = await repository.findCostWorklistRows({ ...base, tab: 'sold' }, window, 'PLN');

    expect(row).toMatchObject({
      variantId: 'v1',
      productName: 'Cup',
      netSales30d: 12.5,
      units30d: 3,
      soldOnConnectionIds: [],
    });
  });

  it('should count with the same filters and no paging or ordering', async () => {
    const { repository, outer } = build({ one: { total: '42' } });
    await expect(
      repository.countCostWorklist({ tab: 'sold', q: 'cup' }, window, 'PLN')
    ).resolves.toBe(42);
    expect(outer.some((c) => c.method === 'limit' || c.method === 'orderBy')).toBe(false);
    expect(outer.find((c) => c.method === 'select')?.args).toEqual(['COUNT(*)', 'total']);
  });

  it('should count variants and products without cost for the summary', async () => {
    const { repository } = build({
      one: { variants_without_cost: '5', products_without_cost: '2', variants_with_cost: '9' },
    });
    await expect(repository.getCostSummary()).resolves.toEqual({
      variantsWithoutCost: 5,
      productsWithoutCost: 2,
      variantsWithCost: 9,
    });
  });
});
