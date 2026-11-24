/**
 * CategoryMappingTree
 *
 * The category map: every category of the catalogue in tree order, each
 * beside the marketplace category it goes to. It is an overview first - the
 * editing happens in a side panel opened from a row - so it opens fully
 * expanded: a catalogue tree is small enough to read whole, and mapping is a
 * pass over every row, so collapsed branches only hide work.
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
  /** Category whose mapping is open in the editor, highlighted in the map. */
  editingCategoryId: string | null;
  onEdit: (categoryId: string) => void;
  sourceHeader: string;
  targetHeader: string;
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
  editingCategoryId,
  onEdit,
  sourceHeader,
  targetHeader,
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

  return (
    <div className="category-map" role="table" aria-label={sourceHeader}>
      <div className="category-map__head" role="row">
        <span role="columnheader">{sourceHeader}</span>
        <span role="columnheader">{targetHeader}</span>
      </div>
      {visible.length === 0 ? (
        <p className="category-map__empty" role="status">
          {query !== ''
            ? interpolate(copy.treeNoMatch, { query: filter.trim() })
            : copy.treeAllMapped}
        </p>
      ) : (
        visible.map(({ node, level }) => (
          <CategoryMappingRow
            key={node.id}
            id={node.id}
            name={node.name}
            level={level}
            mapping={mappingIndex.get(node.id)}
            isEditing={editingCategoryId === node.id}
            hasChildren={node.children.length > 0}
            isExpanded={isNarrowed || !collapsed.has(node.id)}
            canToggle={!isNarrowed}
            onToggle={toggle}
            onEdit={onEdit}
          />
        ))
      )}
    </div>
  );
}
