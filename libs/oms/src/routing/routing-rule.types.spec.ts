import { coerceRoutingRule, coerceRoutingRules, isRoutingRule } from './routing-rule.types';
import { RoutingFilterNameValues, RoutingSortNameValues } from './routing-vocabulary.types';

const validFilter = { id: 'r1', position: 1, kind: 'filter', name: 'in-stock', afterAction: 'no-split' };
const validSort = { id: 'r2', position: 2, kind: 'sort', name: 'priority', afterAction: 'line-split' };

describe('coerceRoutingRule', () => {
  it('should narrow a well-formed filter row when every field is recognised', () => {
    expect(coerceRoutingRule(validFilter)).toEqual({
      id: 'r1',
      position: 1,
      kind: 'filter',
      name: 'in-stock',
      afterAction: 'no-split',
    });
  });

  it('should default priorityLocationIds to empty when a sort row omits it', () => {
    expect(coerceRoutingRule(validSort)).toEqual({
      id: 'r2',
      position: 2,
      kind: 'sort',
      name: 'priority',
      afterAction: 'line-split',
      priorityLocationIds: [],
    });
  });

  it('should keep only string entries when priorityLocationIds is mixed', () => {
    const rule = coerceRoutingRule({ ...validSort, priorityLocationIds: ['a', 3, null, '', 'b'] });
    expect(rule).toMatchObject({ priorityLocationIds: ['a', 'b'] });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'in-stock'],
    ['an array', []],
  ])('should not match when the row is %s', (_label, value) => {
    expect(coerceRoutingRule(value)).toBeNull();
  });

  it.each([
    ['the id is missing', { ...validFilter, id: undefined }],
    ['the id is empty', { ...validFilter, id: '' }],
    ['the position is not a number', { ...validFilter, position: '1' }],
    ['the position is not finite', { ...validFilter, position: Number.NaN }],
    ['the kind is unrecognised', { ...validFilter, kind: 'transform' }],
    ['the afterAction is unrecognised', { ...validFilter, afterAction: 'explode' }],
  ])('should not match when %s', (_label, value) => {
    expect(coerceRoutingRule(value)).toBeNull();
  });

  it('should not match a filter naming a sort, nor a sort naming a filter', () => {
    expect(coerceRoutingRule({ ...validFilter, name: 'priority' })).toBeNull();
    expect(coerceRoutingRule({ ...validSort, name: 'in-stock' })).toBeNull();
  });

  it('should not match `method-capable`, which this build deliberately does not declare (#2736)', () => {
    expect(coerceRoutingRule({ ...validFilter, name: 'method-capable' })).toBeNull();
  });

  it('should accept every declared vocabulary member, so no name is unreachable', () => {
    for (const name of RoutingFilterNameValues) {
      expect(coerceRoutingRule({ ...validFilter, name })).not.toBeNull();
    }
    for (const name of RoutingSortNameValues) {
      expect(coerceRoutingRule({ ...validSort, name })).not.toBeNull();
    }
  });
});

describe('isRoutingRule', () => {
  it('should agree with the coercer on a valid and an invalid row', () => {
    expect(isRoutingRule(validFilter)).toBe(true);
    expect(isRoutingRule({ ...validFilter, name: 'nope' })).toBe(false);
  });
});

describe('coerceRoutingRules', () => {
  it.each([
    ['null', null],
    ['a record rather than an array', { rules: [] }],
    ['a string', 'rules'],
  ])('should yield no rules when the collection is %s', (_label, value) => {
    expect(coerceRoutingRules(value)).toEqual([]);
  });

  it('should drop only the malformed rows and keep the rest', () => {
    const rules = coerceRoutingRules([validFilter, { id: 'bad' }, validSort]);
    expect(rules.map((rule) => rule.id)).toEqual(['r1', 'r2']);
  });

  it('should order by position rather than by the order rows arrived in', () => {
    const rules = coerceRoutingRules([
      { ...validSort, id: 'late', position: 9 },
      { ...validFilter, id: 'early', position: 0 },
    ]);
    expect(rules.map((rule) => rule.id)).toEqual(['early', 'late']);
  });

  it('should break a position tie deterministically by id, never by row order', () => {
    const forwards = coerceRoutingRules([
      { ...validFilter, id: 'b', position: 1 },
      { ...validFilter, id: 'a', position: 1 },
    ]);
    const backwards = coerceRoutingRules([
      { ...validFilter, id: 'a', position: 1 },
      { ...validFilter, id: 'b', position: 1 },
    ]);
    expect(forwards.map((rule) => rule.id)).toEqual(['a', 'b']);
    expect(backwards.map((rule) => rule.id)).toEqual(['a', 'b']);
  });

  it('should never throw on hostile input', () => {
    expect(() => coerceRoutingRules([undefined, Number.NaN, [], () => undefined])).not.toThrow();
  });
});
