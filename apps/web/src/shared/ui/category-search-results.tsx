/**
 * CategorySearchResults (#2075)
 *
 * Flat result list for a whole-tree category search — the sibling surface to
 * `CategoryTreeBrowser`, shown INSTEAD of the tree while a query is active.
 *
 * ## Why a separate primitive rather than a mode on CategoryTreeBrowser
 *
 * Only one of the three pickers that need search actually uses that primitive;
 * the two bulk modals hand-roll their own lists. A "results mode" there would
 * have served one surface and left the other two needing this component
 * anyway. The shapes also differ structurally rather than by degree: a result
 * list has no breadcrumb navigation, no drill-in, and no `onNavigate` — and
 * the tree primitive's documented `key`-remount breadcrumb-reset contract is
 * precisely the state a search must bypass.
 *
 * ## Why each row carries a breadcrumb
 *
 * A hit can come from anywhere in the tree. The operator has not drilled to it,
 * so "Buty" alone is unintelligible — `Moda › Buty damskie › Buty` is not. The
 * backend derives the path per hit for exactly this reason (ADR-037).
 *
 * Domain-agnostic like its sibling: the node shape is declared locally so
 * `shared/ui/` imports nothing from `features/` (frontend-architecture.md
 * §Dependency Rules; ESLint enforces it).
 *
 * @module apps/web/src/shared/ui
 */
import { forwardRef } from 'react';
import { Button } from './button';
import { LoadingState, ErrorState, EmptyState } from './feedback-state';

/**
 * Minimal hit shape. Structurally compatible with `CategorySearchHit` from
 * `features/mappings`, but defined here to keep `shared/` feature-free.
 */
export interface CategorySearchResultHit {
  id: string;
  name: string;
  leaf: boolean;
  /** Root -> leaf, inclusive of the hit itself. */
  path: readonly { id: string; name: string }[];
}

export interface CategorySearchResultsProps {
  /** Hits for the active query; `undefined` while the consumer's query loads. */
  hits: readonly CategorySearchResultHit[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onSelect: (hit: CategorySearchResultHit) => void;
  /**
   * Which hits are selectable. Marketplace pickers pass `(h) => h.leaf` (an
   * offer must sit on a leaf); the shop picker passes `() => true` (a product
   * may sit in any node — ADR-024).
   */
  canSelect: (hit: CategorySearchResultHit) => boolean;
  /** Highlights the currently-chosen category if it appears in the results. */
  selectedId?: string | null;
  /**
   * Distinguishes "this taxonomy has never synced" from "no matches for this
   * query". Both come back as an empty array, so the caller — which knows
   * whether the tree itself is empty — must say which it is. Conflating them
   * would surface the read model's staleness as a broken search, the exact
   * confusion #2075 exists to remove.
   */
  emptyReason: 'no-matches' | 'not-synced';
  /** Echoed in the no-matches copy so the operator sees what was searched. */
  query: string;
  disabled?: boolean;
  /** Merged onto the list root, never replacing the base class. */
  className?: string;
}

export const CategorySearchResults = forwardRef<HTMLUListElement, CategorySearchResultsProps>(
  function CategorySearchResults(
    {
      hits,
      isLoading,
      error,
      onRetry,
      onSelect,
      canSelect,
      selectedId = null,
      emptyReason,
      query,
      disabled = false,
      className = '',
    },
    ref
  ) {
    if (isLoading) {
      return (
        <LoadingState
          liveRegion="off"
          title="Searching categories"
          message="Searching the whole tree…"
        />
      );
    }

    if (error) {
      return (
        <ErrorState
          title="Unable to search categories"
          message={error.message}
          action={<Button onClick={onRetry}>Retry</Button>}
        />
      );
    }

    const results = hits ?? [];

    if (results.length === 0) {
      return emptyReason === 'not-synced' ? (
        <EmptyState
          liveRegion="off"
          title="No categories synced yet"
          message="This destination's category tree has not been synced. Search will work once the first sync completes."
        />
      ) : (
        <EmptyState
          liveRegion="off"
          title="No matching categories"
          message={`Nothing in this tree matches "${query.trim()}". Try a shorter or differently-spelled term.`}
        />
      );
    }

    return (
      <>
        {/* Results arrive asynchronously as the operator types and replace the
            tree in place, so without this a screen-reader user gets no signal
            that anything happened. The drill-down path does not need it — there
            the user initiated a navigation and focus moves — which is why the
            feedback states above keep `liveRegion="off"`. */}
        <p className="sr-only" role="status" aria-live="polite">
          {`${results.length} ${results.length === 1 ? 'category' : 'categories'} found`}
        </p>
        <ul
          ref={ref}
          className={['category-search-results', className].filter(Boolean).join(' ')}
          role="list"
        >
          {results.map((hit) => {
            const selectable = canSelect(hit);
            const isCurrent = hit.id === selectedId;
            // Ancestors only — the hit's own name is already the row heading, so
            // repeating it in the trail below would read as a duplicate.
            const ancestors = hit.path.slice(0, -1);

            return (
              <li
                key={hit.id}
                className={[
                  'category-search-results__item',
                  isCurrent ? 'category-search-results__item--current' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="category-search-results__label">
                  <b className="category-search-results__name">{hit.name}</b>
                  {ancestors.length > 0 ? (
                    <small className="category-search-results__path">
                      {ancestors.map((node, i) => (
                        <span key={node.id}>
                          {i > 0 ? (
                            <span className="category-search-results__sep" aria-hidden="true">
                              {' › '}
                            </span>
                          ) : null}
                          {node.name}
                        </span>
                      ))}
                    </small>
                  ) : (
                    <small className="category-search-results__path">Top level</small>
                  )}
                </span>

                {selectable ? (
                  <Button
                    tone={isCurrent ? 'secondary' : 'primary'}
                    type="button"
                    className="button--sm"
                    aria-pressed={isCurrent}
                    aria-label={`Select ${hit.name}`}
                    disabled={disabled}
                    onClick={() => onSelect(hit)}
                  >
                    {isCurrent ? 'Selected' : 'Select'}
                  </Button>
                ) : (
                  // A non-leaf marketplace hit is a real match but not a valid
                  // destination. Saying so beats hiding the row, which would look
                  // like the search missed it.
                  <span className="category-search-results__unselectable">Not selectable</span>
                )}
              </li>
            );
          })}
        </ul>
      </>
    );
  }
);
