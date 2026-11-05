/**
 * CategoryMappingTree
 *
 * The master's category tree, one row per category with the marketplace
 * category it is mapped to. Opens fully expanded: a catalogue tree is small
 * enough to read whole, and mapping is a pass over every row, so collapsed
 * branches only hide work.
 *
 * `filter` narrows to matching names (their ancestors stay, so a match is
 * never shown without its place in the tree) and `unmappedOnly` to the rows
 * still missing a mapping.
 *
 * @module apps/web/src/features/mappings/components
 */

import { useState, useMemo, type ReactElement } from 'react';
import { CategoryMappingRow } from './CategoryMappingRow';
import { useMessages, interpolate } from '../../../shared/i18n';
import type { CategoryMapping } from '../api/mappings.types';

interface TreeCategory {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
}

interface CategoryMappingTreeProps {
  categories: TreeCategory[];
  mappings: CategoryMapping[];
  selectedCategoryId: string | null;
  onSelect: (categoryId: string) => void;
  /** Accessible name of the tree, naming the platform it lists. */
  label: string;
  filter?: string;
  unmappedOnly?: boolean;
}

interface TreeNode extends TreeCategory {
  children: TreeNode[];
}

interface VisibleNode {
  node: TreeNode;
  level: number;
}

function buildTree(categories: TreeCategory[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const cat of categories) {
    byId.set(cat.id, { ...cat, children: [] });
  }

  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function CategoryMappingTree({
  categories,
  mappings,
  selectedCategoryId,
  onSelect,
  label,
  filter = '',
  unmappedOnly = false,
}: CategoryMappingTreeProps): ReactElement {
  const copy = useMessages('mappings').categoryMappings;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(categories), [categories]);

  const mappingIndex = useMemo(() => {
    const index = new Map<string, CategoryMapping>();
    for (const m of mappings) {
      index.set(m.prestashopCategoryId, m);
    }
    return index;
  }, [mappings]);

  const query = normalise(filter);
  const isNarrowed = query !== '' || unmappedOnly;

  const visible = useMemo(() => {
    const result: VisibleNode[] = [];

    function matches(node: TreeNode): boolean {
      const nameMatches = query === '' || normalise(node.name).includes(query);
      const stateMatches = !unmappedOnly || !mappingIndex.has(node.id);
      return nameMatches && stateMatches;
    }

    // A node is kept when it matches or any descendant does, so a match always
    // appears under its own ancestors.
    function collect(nodes: TreeNode[], level: number, into: VisibleNode[]): boolean {
      let anyKept = false;
      for (const node of nodes) {
        const childRows: VisibleNode[] = [];
        const childKept = collect(node.children, level + 1, childRows);
        if (!isNarrowed || matches(node) || childKept) {
          anyKept = true;
          into.push({ node, level });
          // Narrowing always shows the path to a match, whatever was collapsed.
          if (isNarrowed || !collapsed.has(node.id)) {
            into.push(...childRows);
          }
        }
      }
      return anyKept;
    }

    collect(tree, 0, result);
    return result;
  }, [tree, collapsed, query, unmappedOnly, isNarrowed, mappingIndex]);

  function toggle(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (visible.length === 0) {
    return (
      <p className="category-tree__empty" role="status">
        {query !== ''
          ? interpolate(copy.treeNoMatch, { query: filter.trim() })
          : copy.treeAllMapped}
      </p>
    );
  }

  return (
    <div className="category-tree" role="tree" aria-label={label}>
      {visible.map(({ node, level }) => {
        const hasChildren = node.children.length > 0;
        const isOpen = isNarrowed || !collapsed.has(node.id);
        return (
          <div
            key={node.id}
            role="treeitem"
            aria-level={level + 1}
            aria-selected={selectedCategoryId === node.id}
            aria-expanded={hasChildren ? isOpen : undefined}
            className="category-tree__item"
            style={{ ['--tree-level' as string]: level }}
          >
            {hasChildren ? (
              <button
                type="button"
                className="category-tree__toggle"
                onClick={() => { toggle(node.id); }}
                disabled={isNarrowed}
                aria-label={interpolate(isOpen ? copy.collapse : copy.expand, { name: node.name })}
              >
                <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={isOpen ? 'is-open' : undefined}>
                  <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="category-tree__toggle-placeholder" />
            )}
            <CategoryMappingRow
              id={node.id}
              name={node.name}
              mapping={mappingIndex.get(node.id)}
              isSelected={selectedCategoryId === node.id}
              hasChildren={hasChildren}
              onSelect={onSelect}
            />
          </div>
        );
      })}
    </div>
  );
}
