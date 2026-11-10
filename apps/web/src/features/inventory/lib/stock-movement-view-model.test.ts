import { describe, expect, it } from 'vitest';
import { formatPlural, getMessages } from '../../../shared/i18n';
import type { InventoryMovementRow } from '../api/inventory-movements.types';
import {
  bucketByDay,
  describeGroup,
  describeMovement,
  explainMovement,
  groupMovements,
  guideIdFor,
  movementBadge,
  presentAmount,
  type StockHistoryContext,
} from './stock-movement-view-model';

const copy = getMessages('inventory').stockHistory;
const ctx: StockHistoryContext = {
  copy,
  plural: (n, forms, params) => formatPlural(n, forms, 'en', params),
  masterName: () => 'Shoper',
};

function row(overrides: Partial<InventoryMovementRow> = {}): InventoryMovementRow {
  return {
    kind: 'movement',
    id: 'm1',
    productId: 'p1',
    productVariantId: 'v1',
    sku: 'SKU-1',
    productName: 'Mug',
    locationId: null,
    sourceConnectionId: 'c1',
    reason: 'sale',
    status: 'applied',
    quantityDelta: -1,
    quantityBefore: 10,
    quantityAfter: 9,
    sourceKind: 'order',
    sourceRef: 'ord-1',
    sourceLabel: '#11',
    operatorReason: null,
    note: null,
    actorUserId: null,
    actorName: null,
    refusalReason: null,
    refusalDetail: null,
    occurredAt: '2026-11-09T10:15:00.000Z',
    ...overrides,
  };
}

describe('presentAmount', () => {
  it('should show the change over the resulting stock when the change was applied', () => {
    expect(presentAmount(row(), copy)).toEqual({ change: '−1', result: 'now 9', tone: 'down' });
  });

  it('should show a starting count when there was no earlier number', () => {
    const view = presentAmount(row({ reason: 'master_sync', quantityBefore: null, quantityAfter: 30, quantityDelta: 30 }), copy);
    expect(view).toEqual({ change: '30', result: 'starting count', tone: 'up' });
  });

  it('should say not applied and use the void tone when the change was refused', () => {
    expect(presentAmount(row({ status: 'refused', quantityAfter: null }), copy)).toMatchObject({
      result: 'not applied',
      tone: 'void',
    });
  });

  it('should read a hold as positive while held and negative once released', () => {
    const hold = row({ kind: 'reservation', reason: null, status: 'held', quantityDelta: 2 });
    expect(presentAmount(hold, copy)).toEqual({ change: '+2', result: 'held', tone: 'reserve' });
    expect(presentAmount({ ...hold, status: 'released' }, copy)).toMatchObject({ change: '−2', result: 'released' });
  });
});

describe('describeMovement', () => {
  it('should write one sentence per kind of change', () => {
    expect(describeMovement(row(), ctx)).toBe('Sold in order #11');
    expect(describeMovement(row({ reason: 'master_sync' }), ctx)).toBe('Changed in Shoper');
    expect(describeMovement(row({ reason: 'master_sync', quantityBefore: null }), ctx)).toBe('First count from Shoper');
    expect(describeMovement(row({ kind: 'reservation', reason: null, status: 'held' }), ctx)).toBe('Held for order #11');
    expect(
      describeMovement(row({ reason: 'manual_correction', actorName: 'Ola', operatorReason: 'damaged' }), ctx),
    ).toBe('Corrected by Ola, Damaged');
  });
});

describe('movementBadge', () => {
  it('should badge only states that need a look', () => {
    expect(movementBadge(row(), copy)).toBeNull();
    expect(movementBadge(row({ kind: 'reservation', reason: null, status: 'held' }), copy)).toBeNull();
    expect(movementBadge(row({ status: 'in_doubt' }), copy)).toMatchObject({ tone: 'warning', guideId: 'states.inDoubt' });
  });

  it('should point a normal row at the guide entry for its kind', () => {
    expect(guideIdFor(row({ reason: 'return_restock' }), copy)).toBe('kinds.return');
    expect(guideIdFor(row({ status: 'refused' }), copy)).toBe('states.refused');
  });
});

describe('groupMovements', () => {
  it('should group adjacent applied sync rows from one connection and minute', () => {
    const a = row({ id: 'a', reason: 'master_sync', sourceRef: null });
    const b = row({ id: 'b', reason: 'master_sync', sourceRef: null, occurredAt: '2026-11-09T10:15:40.000Z' });
    const groups = groupMovements([a, b]);
    expect(groups).toHaveLength(1);
    expect(describeGroup(groups[0], ctx)).toMatchObject({
      title: 'Shoper changed 2 products',
      amount: { change: '−1', result: 'each' },
    });
  });

  it('should never hide a refused row inside a group', () => {
    const groups = groupMovements([row({ id: 'a' }), row({ id: 'b', status: 'refused' })]);
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1]);
  });

  it('should keep groups unique when the same event reappears later in the page', () => {
    const groups = groupMovements([row({ id: 'a' }), row({ id: 'x', reason: 'return_restock' }), row({ id: 'b' })]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });
});

describe('bucketByDay', () => {
  it('should label today and yesterday by the local calendar', () => {
    const now = new Date(2026, 10, 9, 12, 0);
    const today = row({ occurredAt: new Date(2026, 10, 9, 8, 0).toISOString() });
    const yesterday = row({ id: 'y', sourceRef: 'ord-2', occurredAt: new Date(2026, 10, 8, 23, 30).toISOString() });
    const days = bucketByDay(groupMovements([today, yesterday]), now, copy, () => 'D');
    expect(days.map((d) => d.label)).toEqual(['Today, D', 'Yesterday, D']);
  });
});

describe('explainMovement', () => {
  it('should flag a state that needs action and show nothing was applied', () => {
    const view = explainMovement(row({ status: 'refused', quantityAfter: null }), ctx, () => '10:15');
    expect(view.attention).toBe(true);
    expect(view.lines.at(-1)).toEqual({ label: 'Applied', value: '0', total: true });
  });

  it('should say a hold left on-hand stock unchanged', () => {
    const view = explainMovement(row({ kind: 'reservation', reason: null, status: 'held', quantityDelta: 3 }), ctx, () => 't');
    expect(view.title).toBe('3 units set aside for order #11');
    expect(view.lines[0]).toEqual({ label: 'On hand', value: 'unchanged' });
  });
});
