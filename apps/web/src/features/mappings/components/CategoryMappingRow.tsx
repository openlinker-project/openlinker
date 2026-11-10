/**
 * CategoryMappingRow
 *
 * One correspondence in the category map: a category of the catalogue, and
 * the marketplace category it goes to. The right-hand cell is the control -
 * it opens the picker for this row - and its look carries the row's state:
 * a mapped row shows its target, a category still to map shows an open slot,
 * and a parent without a mapping of its own stays quiet, because its
 * subcategories usually carry the products.
 *
 * @module apps/web/src/features/mappings/components
 */

import type { CSSProperties, ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { CategoryPathText } from './category-path-text';
import type { CategoryMapping } from '../api/mappings.types';

interface CategoryMappingRowProps {
  id: string;
  name: string;
  level: number;
  mapping: CategoryMapping | undefined;
  isEditing: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  canToggle: boolean;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
}

function ChevronIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={open ? 'is-open' : undefined}>
      <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CategoryMappingRow({
  id,
  name,
  level,
  mapping,
  isEditing,
  hasChildren,
  isExpanded,
  canToggle,
  onToggle,
  onEdit,
}: CategoryMappingRowProps): ReactElement {
  const copy = useMessages('mappings').categoryMappings;
  const state = mapping ? 'mapped' : hasChildren ? 'parent' : 'open';

  return (
    <div
      role="row"
      className={['category-map__row', isEditing ? 'category-map__row--editing' : ''].filter(Boolean).join(' ')}
      data-state={state}
      aria-level={level + 1}
      aria-expanded={hasChildren ? isExpanded : undefined}
      style={{ '--tree-level': level } as CSSProperties}
    >
      <div role="cell" className="category-map__source">
        {hasChildren ? (
          <button
            type="button"
            className="category-map__toggle"
            onClick={() => { onToggle(id); }}
            disabled={!canToggle}
            aria-label={interpolate(isExpanded ? copy.collapse : copy.expand, { name })}
          >
            <ChevronIcon open={isExpanded} />
          </button>
        ) : (
          <span className="category-map__toggle-space" aria-hidden="true" />
        )}
        <span className="category-map__name">{name}</span>
      </div>

      <div role="cell" className="category-map__target">
        <button
          type="button"
          className="category-map__slot"
          onClick={() => { onEdit(id); }}
          aria-haspopup="dialog"
          aria-label={interpolate(mapping ? copy.changeFor : copy.chooseFor, { name })}
        >
          {mapping ? (
            <>
              <CategoryPathText path={mapping.allegroCategoryPath ?? mapping.allegroCategoryName} truncate />
              <span className="category-map__slot-action" aria-hidden="true">{copy.change}</span>
            </>
          ) : (
            <span className="category-map__placeholder">{copy.chooseCategory}</span>
          )}
        </button>
      </div>
    </div>
  );
}
