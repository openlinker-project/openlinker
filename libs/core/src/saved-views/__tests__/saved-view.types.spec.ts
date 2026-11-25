import {
  SAVED_VIEW_LIMITS,
  checkSavedViewDefinition,
  normaliseSavedViewName,
  readSavedViewDefinition,
} from '../domain/types/saved-view.types';

const valid = () => ({
  v: 1,
  query: 'health=attention',
  sort: { key: 'created', dir: 'desc' },
  columns: ['customer', 'money'],
  parts: { money: ['amount', 'payment'] },
});

describe('readSavedViewDefinition', () => {
  it('should return a well-formed definition untouched and not stale', () => {
    const { definition, stale } = readSavedViewDefinition(valid());
    expect(stale).toBe(false);
    expect(definition).toEqual(valid());
  });

  it.each([null, undefined, 'x', 7, [], true])(
    'should not throw and should flag stale when the stored value is %p',
    (raw) => {
      const { definition, stale } = readSavedViewDefinition(raw);
      expect(stale).toBe(true);
      expect(definition).toEqual({ v: 1, query: '', sort: null, columns: [], parts: {} });
    }
  );

  it('should keep what it understands and flag stale when part of the shape is odd', () => {
    const { definition, stale } = readSavedViewDefinition({
      ...valid(),
      columns: 'customer',
      parts: { money: 'amount', ok: ['a'] },
      sort: { key: 3 },
    });
    expect(stale).toBe(true);
    expect(definition.query).toBe('health=attention');
    expect(definition.columns).toEqual([]);
    expect(definition.sort).toBeNull();
    expect(definition.parts).toEqual({ ok: ['a'] });
  });

  it('should flag a newer definition version as stale but still return it', () => {
    const { definition, stale } = readSavedViewDefinition({ ...valid(), v: 9 });
    expect(stale).toBe(true);
    expect(definition.v).toBe(9);
    expect(definition.columns).toEqual(['customer', 'money']);
  });

  it('should treat an absent parts as no deviations, not stale', () => {
    const { parts } = valid();
    expect(parts).toBeDefined();
    const { definition, stale } = readSavedViewDefinition({ ...valid(), parts: undefined });
    expect(stale).toBe(false);
    expect(definition.parts).toEqual({});
  });
});

describe('checkSavedViewDefinition', () => {
  it('should accept a valid definition, with or without optional members', () => {
    expect(checkSavedViewDefinition(valid())).toBeNull();
    expect(checkSavedViewDefinition({ ...valid(), sort: null, pageSize: 50 })).toBeNull();
    expect(checkSavedViewDefinition({ v: 1, query: '', columns: [] })).toBeNull();
  });

  it('should reject a definition that is not an object', () => {
    expect(checkSavedViewDefinition('x')?.rule).toBe('malformed');
    expect(checkSavedViewDefinition(null)?.rule).toBe('malformed');
  });

  it('should reject more than 64 columns', () => {
    const columns = Array.from({ length: SAVED_VIEW_LIMITS.columns + 1 }, (_, i) => `c${i}`);
    expect(checkSavedViewDefinition({ ...valid(), columns })).toMatchObject({
      rule: 'too-many-columns',
      limit: 64,
    });
  });

  it('should accept exactly 64 columns', () => {
    const columns = Array.from({ length: SAVED_VIEW_LIMITS.columns }, (_, i) => `c${i}`);
    expect(checkSavedViewDefinition({ ...valid(), columns, parts: {} })).toBeNull();
  });

  it('should reject a query over 2048 characters', () => {
    expect(
      checkSavedViewDefinition({ ...valid(), query: 'a'.repeat(SAVED_VIEW_LIMITS.queryChars + 1) })
    ).toMatchObject({ rule: 'query-too-long', limit: 2048 });
  });

  it('should reject a definition over 16 KB serialized', () => {
    // Each part list is within its own limits; the total is what breaks.
    const parts: Record<string, string[]> = {};
    for (let i = 0; i < 60; i++) parts[`column-${i}`] = Array.from({ length: 60 }, (_, j) => `part-${j}`);
    expect(checkSavedViewDefinition({ ...valid(), parts })).toMatchObject({
      rule: 'definition-too-large',
      limit: 16384,
    });
  });

  it.each([
    ['sort direction', { sort: { key: 'a', dir: 'up' } }],
    ['sort key', { sort: { key: '', dir: 'asc' } }],
    ['columns type', { columns: [1] }],
    ['parts value', { parts: { a: 'b' } }],
    ['pageSize', { pageSize: 0 }],
    ['v', { v: 0 }],
    ['query type', { query: 1 }],
  ])('should reject a malformed %s', (_label, patch) => {
    expect(checkSavedViewDefinition({ ...valid(), ...patch })?.rule).toBe('malformed');
  });
});

describe('normaliseSavedViewName', () => {
  it('should trim and accept a normal name', () => {
    expect(normaliseSavedViewName('  Needs a look ')).toBe('Needs a look');
  });

  it.each(['', '   ', 'x'.repeat(101), 5, null])('should refuse %p', (raw) => {
    expect(normaliseSavedViewName(raw)).toBeNull();
  });
});
