import { describe, expect, it } from 'vitest';
import type { ViewDefinition } from './saved-view.types';
import { diffViews, isDirty } from './view-diff';

const saved: ViewDefinition = {
  v: 1,
  query: 'stage=failed',
  sort: { key: 'created', dir: 'desc' },
  columns: ['customer', 'total'],
  parts: {},
};

describe('diffViews', () => {
  it('should report nothing for an identical list', () => {
    expect(diffViews({ ...saved }, saved)).toEqual([]);
    expect(isDirty({ ...saved }, saved)).toBe(false);
  });

  it('should treat two spellings of the same filters as equal', () => {
    const draft = { ...saved, query: 'source=Allegro&stage=failed' };
    const same = { ...saved, query: 'stage=failed&source=Allegro' };
    expect(diffViews(draft, same)).toEqual([]);
  });

  it('should report changed filters', () => {
    expect(diffViews({ ...saved, query: 'stage=ready' }, saved)).toEqual(['filters']);
  });

  it('should report a changed sort direction', () => {
    expect(diffViews({ ...saved, sort: { key: 'created', dir: 'asc' } }, saved)).toEqual(['sort']);
  });

  it('should report a reordered column list as columns', () => {
    expect(diffViews({ ...saved, columns: ['total', 'customer'] }, saved)).toEqual(['columns']);
  });

  it('should report a changed field list as fields when the columns are unchanged', () => {
    expect(diffViews({ ...saved, parts: { total: ['payment'] } }, saved)).toEqual(['fields']);
  });

  it('should say only columns when columns and fields both changed', () => {
    const draft = { ...saved, columns: ['customer'], parts: { total: ['payment'] } };
    expect(diffViews(draft, saved)).toEqual(['columns']);
  });

  it('should still be dirty for a fields-only edit made next to a column change', () => {
    const draft = { ...saved, columns: ['customer'], parts: { total: ['payment'] } };
    expect(isDirty(draft, saved)).toBe(true);
  });

  it('should list several kinds at once, in a stable order', () => {
    const draft = { ...saved, query: '', sort: { key: 'total', dir: 'asc' as const }, columns: ['total'] };
    expect(diffViews(draft, saved)).toEqual(['filters', 'sort', 'columns']);
  });
});
