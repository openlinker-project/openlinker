/** The category fork behind the barcode-vs-mapping comparison (#3994). */
import { describe, expect, it } from 'vitest';
import { forkPaths } from './bulk-card-category-dialog';

const n = (...names: string[]): Array<{ id: string; name: string }> => names.map((name) => ({ id: name, name }));

describe('forkPaths', () => {
  it('should share the trunk up to the first differing category', () => {
    const { shared, restA, restB } = forkPaths(
      n('Moda', 'Odzież', 'T-shirty'),
      n('Moda', 'Odzież', 'Koszulki polo'),
    );
    expect(shared.map((x) => x.name)).toEqual(['Moda', 'Odzież']);
    expect(restA.map((x) => x.name)).toEqual(['T-shirty']);
    expect(restB.map((x) => x.name)).toEqual(['Koszulki polo']);
  });

  it('should share nothing when the two paths start in different branches', () => {
    const { shared, restA, restB } = forkPaths(n('Moda', 'T-shirty'), n('Elektronika', 'Powerbanki'));
    expect(shared).toEqual([]);
    expect(restA).toHaveLength(2);
    expect(restB).toHaveLength(2);
  });

  it('should compare by id, not by name', () => {
    const { shared } = forkPaths(
      [{ id: '1', name: 'Akcesoria' }],
      [{ id: '2', name: 'Akcesoria' }],
    );
    expect(shared).toEqual([]);
  });
});
