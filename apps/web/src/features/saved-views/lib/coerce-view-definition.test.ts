import { describe, expect, it } from 'vitest';
import { coerceViewDefinition } from './coerce-view-definition';

describe('coerceViewDefinition', () => {
  it('should read a well-formed definition as it is', () => {
    const raw = { v: 1, query: 'a=1', sort: { key: 'total', dir: 'asc' }, columns: ['x'], parts: { x: ['y'] }, pageSize: 50 };
    expect(coerceViewDefinition(raw)).toEqual(raw);
  });

  it('should never throw on something that is not a definition', () => {
    for (const raw of [null, undefined, 'x', 7, [], { columns: 'no', parts: 3, sort: 'no', query: 9 }]) {
      expect(() => coerceViewDefinition(raw)).not.toThrow();
    }
  });

  it('should degrade unreadable fields to empty ones', () => {
    expect(coerceViewDefinition({ columns: [1, 'a', null], parts: { a: 'no', b: ['c', 2] }, sort: { key: '' } })).toEqual({
      v: 1,
      query: '',
      sort: null,
      columns: ['a'],
      parts: { a: [], b: ['c'] },
    });
  });
});
