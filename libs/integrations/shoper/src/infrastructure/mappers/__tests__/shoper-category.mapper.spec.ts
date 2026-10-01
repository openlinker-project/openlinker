import type { ShoperCategory, ShoperCategoryTreeNode } from '../../../domain/types/shoper-api.types';
import { flattenShoperCategoryTree, joinShoperCategories } from '../shoper-category.mapper';

function category(id: string, name: string | null, active = '1'): ShoperCategory {
  return { category_id: id, translations: { pl_PL: { name, active }, en_US: { name: `${name ?? ''}-en`, active } } };
}

/** The live trial-shop shape: one root (45) with seven leaves. */
const LIVE_TREE: ShoperCategoryTreeNode[] = [
  { id: 45, children: [38, 39, 40].map((id) => ({ id, children: [] })) },
];

describe('flattenShoperCategoryTree', () => {
  it('should assign parent and depth, with roots at depth 0', () => {
    const positions = flattenShoperCategoryTree([
      { id: 1, children: [{ id: 2, children: [{ id: 3, children: [] }] }] },
    ]);
    expect(Object.fromEntries(positions)).toEqual({
      '1': { depth: 0 },
      '2': { parentId: '1', depth: 1 },
      '3': { parentId: '2', depth: 2 },
    });
  });

  it('should keep the first occurrence of a node reachable twice', () => {
    const positions = flattenShoperCategoryTree([
      { id: 1, children: [{ id: 3, children: [] }] },
      { id: 2, children: [{ id: 3, children: [] }] },
    ]);
    expect(positions.get('3')).toEqual({ parentId: '1', depth: 1 });
  });

  it('should terminate on a cyclic tree', () => {
    const a: { id: number; children: ShoperCategoryTreeNode[] } = { id: 1, children: [] };
    a.children.push({ id: 2, children: [a] });
    expect(flattenShoperCategoryTree([a]).size).toBe(2);
  });

  it('should tolerate a node without a children array', () => {
    const malformed = [{ id: 1 } as unknown as ShoperCategoryTreeNode];
    expect(flattenShoperCategoryTree(malformed).get('1')).toEqual({ depth: 0 });
  });
});

describe('joinShoperCategories', () => {
  it('should join the live shape: names from the list, structure from the tree', () => {
    const { categories, unnamedTreeIds, unplacedIds } = joinShoperCategories(
      [category('45', 'Kolekcje'), category('38', 'Zestawy'), category('39', 'Talerze'), category('40', 'Miski')],
      LIVE_TREE,
      'pl_PL',
    );

    expect(categories).toEqual([
      { id: '45', name: 'Kolekcje', depth: 0, active: true },
      { id: '38', name: 'Zestawy', parentId: '45', depth: 1, active: true },
      { id: '39', name: 'Talerze', parentId: '45', depth: 1, active: true },
      { id: '40', name: 'Miski', parentId: '45', depth: 1, active: true },
    ]);
    expect(unnamedTreeIds).toEqual([]);
    expect(unplacedIds).toEqual([]);
  });

  it('should report an inactive category as inactive', () => {
    const { categories } = joinShoperCategories([category('38', 'Zestawy', '0')], LIVE_TREE, 'pl_PL');
    expect(categories[0].active).toBe(false);
  });

  it('should use the default language and fall back when it has no name', () => {
    expect(joinShoperCategories([category('38', 'Zestawy')], LIVE_TREE, 'en_US').categories[0].name).toBe(
      'Zestawy-en',
    );
    expect(joinShoperCategories([category('38', null)], LIVE_TREE, 'pl_PL').categories[0].name).toBe('-en');
    expect(
      joinShoperCategories([{ category_id: '38', translations: {} }], LIVE_TREE, 'pl_PL').categories[0].name,
    ).toBe('category-38');
  });

  it('should keep a listed category missing from the tree, unplaced, and report it', () => {
    const { categories, unplacedIds } = joinShoperCategories([category('99', 'Sierota')], [], 'pl_PL');
    expect(categories).toEqual([{ id: '99', name: 'Sierota', active: true }]);
    expect(unplacedIds).toEqual(['99']);
  });

  it('should drop a tree node that has no category record, and report it', () => {
    const { categories, unnamedTreeIds } = joinShoperCategories([category('38', 'Zestawy')], LIVE_TREE, 'pl_PL');
    expect(categories.map((c) => c.id)).toEqual(['38']);
    expect(unnamedTreeIds).toEqual(['45', '39', '40']);
  });

  it('should ignore a duplicated list row', () => {
    const { categories } = joinShoperCategories(
      [category('38', 'Zestawy'), category('38', 'Duplikat')],
      LIVE_TREE,
      'pl_PL',
    );
    expect(categories.map((c) => c.name)).toEqual(['Zestawy']);
  });
});
