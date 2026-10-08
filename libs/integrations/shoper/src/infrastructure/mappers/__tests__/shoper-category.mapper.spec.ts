import type { ShoperCategory, ShoperCategoryTreeNode } from '../../../domain/types/shoper-api.types';
import {
  findShoperCategoryChild,
  flattenShoperCategoryTree,
  joinShoperCategories,
} from '../shoper-category.mapper';

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

  it('should use the default language and fall back to another language that has a name', () => {
    expect(joinShoperCategories([category('38', 'Zestawy')], LIVE_TREE, 'en_US').categories[0].name).toBe(
      'Zestawy-en',
    );
    const onlyEnglish: ShoperCategory = {
      category_id: '38',
      translations: { pl_PL: { name: '', active: '1' }, en_US: { name: 'Sets', active: '1' } },
    };
    expect(joinShoperCategories([onlyEnglish], LIVE_TREE, 'pl_PL').categories[0].name).toBe('Sets');
  });

  it.each([
    ['no translations at all', { category_id: '38', translations: {} }],
    ['only blank names', { category_id: '38', translations: { pl_PL: { name: '  ' }, en_US: { name: null } } }],
  ])('should skip a category with %s instead of inventing a label, and report it', (_label, raw) => {
    const { categories, unnamedIds } = joinShoperCategories(
      [raw as ShoperCategory, category('39', 'Talerze')],
      LIVE_TREE,
      'pl_PL',
    );

    expect(categories.map((c) => c.id)).toEqual(['39']);
    expect(unnamedIds).toEqual(['38']);
    expect(JSON.stringify(categories)).not.toContain('category-');
  });

  it('should not also report a nameless listed category as a tree node without a record', () => {
    const { unnamedTreeIds } = joinShoperCategories(
      [{ category_id: '38', translations: {} }],
      [{ id: 38, children: [] }],
      'pl_PL',
    );

    expect(unnamedTreeIds).toEqual([]);
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

describe('findShoperCategoryChild', () => {
  const categories = [
    { id: '45', name: 'Kuchnia', depth: 0 },
    { id: '38', name: 'Zestawy', parentId: '45', depth: 1 },
    { id: '60', name: 'Zestawy', parentId: '45', depth: 1 },
    { id: '70', name: 'Zestawy', depth: 0 },
    { id: '80', name: 'Zestawy' },
  ];

  it('should find a root by name', () => {
    expect(findShoperCategoryChild(categories, null, 'Kuchnia')).toBe('45');
  });

  it('should find a child under its own parent only', () => {
    expect(findShoperCategoryChild(categories, '45', 'Zestawy')).toBe('38');
    expect(findShoperCategoryChild(categories, '38', 'Zestawy')).toBeNull();
  });

  it('should take the lowest id when the shop holds a duplicate, so racing publishes converge', () => {
    expect(findShoperCategoryChild(categories, '45', 'Zestawy')).toBe('38');
    expect(findShoperCategoryChild(categories, null, 'Zestawy')).toBe('70');
  });

  it('should never match a category the tree does not place, whose parent is unknown', () => {
    expect(findShoperCategoryChild([{ id: '80', name: 'Loose' }], null, 'Loose')).toBeNull();
  });

  it('should ignore surrounding whitespace in the wanted name', () => {
    expect(findShoperCategoryChild(categories, null, '  Kuchnia ')).toBe('45');
  });

  it('should be exact about case, because the shop stores the name as typed', () => {
    expect(findShoperCategoryChild(categories, null, 'kuchnia')).toBeNull();
  });

  it('should match an inactive category too, since the directory carries it like any other', () => {
    const withInactive = [{ id: '90', name: 'Ukryta', depth: 0, active: false }];

    expect(findShoperCategoryChild(withInactive, null, 'Ukryta')).toBe('90');
  });
});
