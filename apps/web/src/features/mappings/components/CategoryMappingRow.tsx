/**
 * CategoryMappingRow
 *
 * A single row in the PrestaShop category tree. Shows the category name,
 * its mapped Allegro category (or unmapped indicator), and responds to clicks.
 *
 * @module apps/web/src/features/mappings/components
 */

import type { ReactElement } from 'react';
import type { CategoryMapping } from '../api/mappings.types';

interface CategoryMappingRowProps {
  id: string;
  name: string;
  depth: number;
  mapping: CategoryMapping | undefined;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export function CategoryMappingRow({
  id,
  name,
  depth,
  mapping,
  isSelected,
  onSelect,
}: CategoryMappingRowProps): ReactElement {
  const paddingLeft = `${depth * 1.25}rem`;

  return (
    <button
      type="button"
      className={['category-row', isSelected ? 'category-row--selected' : ''].filter(Boolean).join(' ')}
      style={{ paddingLeft }}
      onClick={() => { onSelect(id); }}
      aria-pressed={isSelected}
    >
      <span className="category-row__name">{name}</span>
      {mapping ? (
        <span className="category-row__badge category-row__badge--mapped">
          {mapping.allegroCategoryName}
        </span>
      ) : (
        <span className="category-row__badge category-row__badge--unmapped">
          — not mapped —
        </span>
      )}
    </button>
  );
}
