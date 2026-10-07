/**
 * Shoper Category Mapper
 *
 * Shoper splits one category across two resources, verified on a live shop:
 * `GET /categories-tree` carries the STRUCTURE (ids and children, no names),
 * and the paged `GET /categories` carries the TEXT (per-language name and
 * `active`). These pure functions join the two into the neutral `Category`.
 *
 * Join rules, each chosen so an inconsistent pair cannot produce a false
 * statement:
 *   - in the list, not in the tree: kept without `parentId` / `depth` (a
 *     category exists; only its place is unknown);
 *   - in the tree, not in the list: dropped - with no name it cannot be shown
 *     truthfully;
 *   - in the list with no name in any language: dropped for the same reason
 *     (no invented `category-<id>` label), and reported;
 *   - a node seen twice (or a cycle): first occurrence wins, so a malformed
 *     tree cannot loop or report two parents.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { Category } from '@openlinker/core/products';

import type {
  ShoperCategory,
  ShoperCategoryTranslation,
  ShoperCategoryTreeNode,
} from '../../domain/types/shoper-api.types';

export interface ShoperTreePosition {
  readonly parentId?: string;
  readonly depth: number;
}

export interface ShoperCategoryJoin {
  readonly categories: Category[];
  /** Ids present in the tree but missing from the list (dropped). */
  readonly unnamedTreeIds: string[];
  /** Ids present in the list but missing from the tree (kept, unplaced). */
  readonly unplacedIds: string[];
  /** Ids listed with no name in ANY language (dropped: a label would be invented). */
  readonly unnamedIds: string[];
}

/** Walks the tree iteratively; root depth is 0. */
export function flattenShoperCategoryTree(
  roots: readonly ShoperCategoryTreeNode[],
): Map<string, ShoperTreePosition> {
  const positions = new Map<string, ShoperTreePosition>();
  const stack: Array<{ node: ShoperCategoryTreeNode; parentId?: string; depth: number }> = roots
    .map((node) => ({ node, depth: 0 }))
    .reverse();

  while (stack.length > 0) {
    const { node, parentId, depth } = stack.pop() as (typeof stack)[number];
    const id = String(node.id);
    if (positions.has(id)) {
      continue;
    }
    positions.set(id, parentId === undefined ? { depth } : { parentId, depth });
    // A malformed node may arrive without `children`; the wire is not trusted.
    const children: readonly ShoperCategoryTreeNode[] = Array.isArray(node.children)
      ? node.children
      : [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: children[i], parentId: id, depth: depth + 1 });
    }
  }
  return positions;
}

function pickTranslation(
  translations: Readonly<Record<string, ShoperCategoryTranslation>> | undefined,
  language: string,
): ShoperCategoryTranslation | undefined {
  if (translations === undefined) {
    return undefined;
  }
  const hasName = (t: ShoperCategoryTranslation | undefined): boolean =>
    typeof t?.name === 'string' && t.name.trim().length > 0;
  const preferred = translations[language];
  return hasName(preferred) ? preferred : Object.values(translations).find(hasName);
}

export function joinShoperCategories(
  list: readonly ShoperCategory[],
  tree: readonly ShoperCategoryTreeNode[],
  language: string,
): ShoperCategoryJoin {
  const positions = flattenShoperCategoryTree(tree);
  const listed = new Set<string>();
  const categories: Category[] = [];
  const unplacedIds: string[] = [];
  const unnamedIds: string[] = [];

  for (const raw of list) {
    const id = String(raw.category_id);
    if (listed.has(id)) {
      continue;
    }
    listed.add(id);
    const translation = pickTranslation(raw.translations, language);
    const name = translation?.name?.trim();
    if (translation === undefined || name === undefined || name.length === 0) {
      // Same rule as a tree node with no record: without a name it cannot be
      // shown truthfully, and a placeholder label would read as a real one.
      unnamedIds.push(id);
      continue;
    }
    const position = positions.get(id);
    if (position === undefined) {
      unplacedIds.push(id);
    }
    categories.push({
      id,
      name,
      ...(position?.parentId === undefined ? {} : { parentId: position.parentId }),
      ...(position === undefined ? {} : { depth: position.depth }),
      ...(translation?.active === undefined || translation.active === null
        ? {}
        : { active: translation.active === '1' }),
    });
  }

  const unnamedTreeIds = [...positions.keys()].filter((id) => !listed.has(id));
  return { categories, unnamedTreeIds, unplacedIds, unnamedIds };
}

/**
 * The id of the category called `name` directly under `parentId` (`null` = the
 * root level), or `null` when there is none.
 *
 * Shoper does not refuse a duplicate name under one parent, so two can exist;
 * the LOWEST id wins. That is deterministic, which is what lets two publishes
 * that raced to create the same node both settle on the same one afterwards.
 * A category the tree does not place (no `depth`) is never a candidate: its
 * parent is unknown, so matching it would be a guess.
 */
export function findShoperCategoryChild(
  categories: readonly Category[],
  parentId: string | null,
  name: string,
): string | null {
  const wanted = name.trim();
  const candidates = categories.filter(
    (category) =>
      category.name === wanted &&
      category.depth !== undefined &&
      (parentId === null ? category.parentId === undefined : category.parentId === parentId),
  );
  const [lowest] = candidates
    .map((category) => category.id)
    .sort((a, b) => Number(a) - Number(b));
  return lowest ?? null;
}
