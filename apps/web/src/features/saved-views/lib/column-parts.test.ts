import { describe, expect, it } from 'vitest';
import { partIds, partsOf, reorder, setPartsIn } from './column-parts';
import { testRegistry } from './saved-views.fixtures';

const total = testRegistry.columns.find((column) => column.id === 'total')!;

describe('column parts', () => {
  it('should list every field id in the default order', () => {
    expect(partIds(total)).toEqual(['amount', 'payment', 'created']);
  });

  it('should show the default fields when the view stores no deviation', () => {
    expect(partsOf(total, { parts: {} }).map((part) => part.id)).toEqual(['amount', 'payment', 'created']);
  });

  it('should show the stored fields in the stored order and skip unknown ids', () => {
    const visible = partsOf(total, { parts: { total: ['created', 'ghost', 'amount'] } });
    expect(visible.map((part) => part.id)).toEqual(['created', 'amount']);
  });

  it('should store only a deviation from the default', () => {
    const changed = setPartsIn(total, { parts: {} }, ['payment', 'amount', 'created']);
    expect(changed.parts).toEqual({ total: ['payment', 'amount', 'created'] });
  });

  it('should drop the entry when the fields are set back to the default', () => {
    const restored = setPartsIn(total, { parts: { total: ['payment', 'amount', 'created'] } }, ['amount', 'payment', 'created']);
    expect(restored.parts).toEqual({});
  });

  it('should not mutate the view it was given', () => {
    const view = { parts: { other: ['x'] } };
    setPartsIn(total, view, ['amount']);
    expect(view.parts).toEqual({ other: ['x'] });
  });

  describe('reorder', () => {
    it('should move an item to a new position', () => {
      expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    });

    it('should leave the list unchanged when the target is out of range', () => {
      expect(reorder(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
      expect(reorder(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
    });

    it('should return a copy, never the input', () => {
      const input = ['a', 'b'];
      expect(reorder(input, 0, 5)).not.toBe(input);
    });
  });
});
