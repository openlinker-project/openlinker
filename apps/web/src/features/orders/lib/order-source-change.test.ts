import { describe, expect, it } from 'vitest';

import type { OrderAmendmentChange, OrderOmsAttentionEntry } from '../api/orders.types';
import { describeSourceChange } from './order-source-change';

const LOWERED: OrderAmendmentChange[] = [
  { kind: 'line-quantity-changed', lineId: 'li_1', sku: 'MUG-350', fromQuantity: 2, toQuantity: 1 },
];

const entry = (detail: string): OrderOmsAttentionEntry => ({
  producer: 'source-amendment',
  reason: 'source-change-unapplied',
  detail,
});

const base = {
  lastAmendmentChanges: LOWERED,
  omsAttention: [] as OrderOmsAttentionEntry[],
  itemNames: { li_1: 'Ceramic mug 350 ml' },
  hasPackingWork: true,
};

describe('describeSourceChange (#3961)', () => {
  it('should render nothing when the shop changed no line', () => {
    expect(describeSourceChange({ ...base, lastAmendmentChanges: [] })).toBeNull();
  });

  it('should not repeat the SKU under a line that is already named by it', () => {
    const view = describeSourceChange({ ...base, itemNames: {} });

    expect(view?.lines[0]).toMatchObject({ name: 'MUG-350', sku: null });
  });

  it('should render nothing for an order without packing work', () => {
    expect(describeSourceChange({ ...base, hasPackingWork: false })).toBeNull();
  });

  it('should report applied with no actions when no attention entry is left', () => {
    const view = describeSourceChange(base);

    expect(view?.status).toBe('applied');
    expect(view?.actions).toEqual([]);
    expect(view?.lines).toEqual([
      { key: 'li_1:0', name: 'Ceramic mug 350 ml', sku: 'MUG-350', from: 2, to: 1 },
    ]);
  });

  it('should ask for a decision with check-again first and keep second while the box is held', () => {
    const view = describeSourceChange({ ...base, omsAttention: [entry('box-holds-more')] });

    expect(view?.status).toBe('decision');
    expect(view?.actions.map((action) => action.action)).toEqual(['recheck', 'accept']);
    expect(view?.effects[0]?.mark).toBe('todo');
  });

  it('should offer only mark-as-handled after shipping', () => {
    const view = describeSourceChange({ ...base, omsAttention: [entry('shipped')] });

    expect(view?.status).toBe('shipped');
    expect(view?.actions).toEqual([{ action: 'accept', label: 'handled' }]);
  });

  it('should offer try-again when applying did not finish', () => {
    const view = describeSourceChange({ ...base, omsAttention: [entry('apply-failed')] });

    expect(view?.status).toBe('failed');
    expect(view?.actions.map((action) => action.action)).toEqual(['recheck']);
  });

  it('should fall back to generic copy for a cause this build does not know', () => {
    const view = describeSourceChange({ ...base, omsAttention: [entry('something-new')] });

    expect(view?.status).toBe('decision');
    expect(view?.effects).toEqual([{ mark: 'todo', key: 'noLongerMatches' }]);
  });

  it('should still show a decision when the change itself was not recorded', () => {
    const view = describeSourceChange({ ...base, lastAmendmentChanges: null, omsAttention: [entry('box-closed')] });

    expect(view?.status).toBe('decision');
    expect(view?.lines).toEqual([]);
  });

  it('should read a removed line as down to zero and an added one as up from zero', () => {
    const view = describeSourceChange({
      ...base,
      lastAmendmentChanges: [
        { kind: 'line-removed', lineId: 'li_9', sku: 'CORK-01', fromQuantity: 1 },
        { kind: 'line-added', lineId: 'li_7', toQuantity: 2 },
      ],
    });

    expect(view?.lines.map((line) => [line.name, line.from, line.to])).toEqual([
      ['CORK-01', 1, 0],
      ['li_7', 0, 2],
    ]);
  });

  it('should ignore an attention entry from another producer', () => {
    const view = describeSourceChange({
      ...base,
      omsAttention: [{ producer: 'routing', reason: 'line-unfulfillable' }],
    });

    expect(view?.status).toBe('applied');
  });
});
