/**
 * CategoryPathText
 *
 * A marketplace category path ("Moda > Obuwie > Sneakersy") read as a
 * breadcrumb: the ancestors quiet, the category itself in full weight, so the
 * eye lands on where the products actually go. With `truncate`, the
 * ancestors give way first and the category name always stays whole.
 *
 * @module apps/web/src/features/mappings/components
 */

import type { ReactElement } from 'react';

interface CategoryPathTextProps {
  /** Path segments joined with " > ", the format mappings are stored in. */
  path: string;
  truncate?: boolean;
}

export function CategoryPathText({ path, truncate = false }: CategoryPathTextProps): ReactElement {
  const parts = path.split(' > ').filter(Boolean);
  const leaf = parts.pop() ?? path;
  return (
    <span
      className={['category-path-text', truncate ? 'category-path-text--truncate' : ''].filter(Boolean).join(' ')}
      title={parts.length > 0 ? path.split(' > ').join(' / ') : undefined}
    >
      {parts.length > 0 ? (
        <>
          <span className="category-path-text__ancestors">{parts.join(' / ')}</span>
          <span className="category-path-text__sep" aria-hidden="true">
            /
          </span>
        </>
      ) : null}
      <span className="category-path-text__leaf">{leaf}</span>
    </span>
  );
}
