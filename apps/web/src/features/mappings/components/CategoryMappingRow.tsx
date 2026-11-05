/**
 * CategoryMappingRow
 *
 * One category of the master's tree: its name, and where it goes on the
 * selected marketplace - the mapped category's name with its full path on
 * hover, or a quiet "Not mapped" so the rows still needing work stand out
 * without turning the list into a wall of status badges.
 *
 * @module apps/web/src/features/mappings/components
 */

import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import type { CategoryMapping } from '../api/mappings.types';

interface CategoryMappingRowProps {
  id: string;
  name: string;
  mapping: CategoryMapping | undefined;
  isSelected: boolean;
  /**
   * A parent category often needs no mapping of its own (its children carry
   * the products), so an unmapped parent stays quiet instead of repeating
   * "Not mapped" down every branch.
   */
  hasChildren?: boolean;
  onSelect: (id: string) => void;
}

export function CategoryMappingRow({
  id,
  name,
  mapping,
  isSelected,
  hasChildren = false,
  onSelect,
}: CategoryMappingRowProps): ReactElement {
  const copy = useMessages('mappings').categoryMappings;

  return (
    <button
      type="button"
      className={['category-row', isSelected ? 'category-row--selected' : ''].filter(Boolean).join(' ')}
      onClick={() => { onSelect(id); }}
      aria-pressed={isSelected}
      data-mapped={mapping ? 'true' : 'false'}
    >
      <span className="category-row__name">{name}</span>
      {mapping ? (
        <span className="category-row__target" title={mapping.allegroCategoryPath ?? mapping.allegroCategoryName}>
          {mapping.allegroCategoryName}
        </span>
      ) : hasChildren ? null : (
        <span className="category-row__target category-row__target--empty">{copy.notMapped}</span>
      )}
    </button>
  );
}
