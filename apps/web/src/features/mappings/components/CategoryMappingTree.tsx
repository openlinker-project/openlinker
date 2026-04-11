/**
 * CategoryMappingTree
 *
 * Expandable/collapsible tree rendering PrestaShop categories.
 * Each row shows the category name and its mapping status.
 *
 * @module apps/web/src/features/mappings/components
 */

import { useState, useMemo, type ReactElement } from 'react';
import { CategoryMappingRow } from './CategoryMappingRow';
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
}

interface TreeNode extends TreeCategory {
  children: TreeNode[];
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

function flattenVisible(nodes: TreeNode[], expanded: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(list: TreeNode[]): void {
    for (const node of list) {
      result.push(node);
      if (node.children.length > 0 && expanded.has(node.id)) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

export function CategoryMappingTree({
  categories,
  mappings,
  selectedCategoryId,
  onSelect,
}: CategoryMappingTreeProps): ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(categories), [categories]);

  const mappingIndex = useMemo(() => {
    const index = new Map<string, CategoryMapping>();
    for (const m of mappings) {
      index.set(m.prestashopCategoryId, m);
    }
    return index;
  }, [mappings]);

  const visible = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);

  function toggleExpand(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Determine which nodes have children for the expand toggle
  const hasChildren = useMemo(() => {
    const parentIds = new Set<string>();
    for (const cat of categories) {
      if (cat.parentId) {
        parentIds.add(cat.parentId);
      }
    }
    return parentIds;
  }, [categories]);

  return (
    <div className="category-tree" role="tree" aria-label="PrestaShop categories">
      {visible.map((node) => (
        <div key={node.id} role="treeitem" aria-expanded={hasChildren.has(node.id) ? expanded.has(node.id) : undefined}>
          <div className="category-tree__row">
            {hasChildren.has(node.id) ? (
              <button
                type="button"
                className="category-tree__toggle"
                onClick={() => { toggleExpand(node.id); }}
                aria-label={expanded.has(node.id) ? `Collapse ${node.name}` : `Expand ${node.name}`}
              >
                {expanded.has(node.id) ? '▾' : '▸'}
              </button>
            ) : (
              <span className="category-tree__toggle-placeholder" />
            )}
            <CategoryMappingRow
              id={node.id}
              name={node.name}
              depth={node.depth}
              mapping={mappingIndex.get(node.id)}
              isSelected={selectedCategoryId === node.id}
              onSelect={onSelect}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
