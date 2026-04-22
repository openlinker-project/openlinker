/**
 * CategoryTreeBrowser
 *
 * Shared primitive for browseable hierarchical category trees. Owns the
 * breadcrumb-navigation UX, per-row Select/Browse actions, and the
 * loading/error/empty feedback states. Domain-agnostic by design — does
 * not know about Allegro or any other platform.
 *
 * Controlled data flow: callers pass pre-fetched `nodes` + query state;
 * primitive owns only the breadcrumb (transient navigation state). On
 * every breadcrumb change the primitive calls `onNavigate(parentId,
 * breadcrumb)` so the caller can refetch children for the new level.
 *
 * ## Breadcrumb reset contract
 *
 * The primitive owns breadcrumb state internally. If a caller's identity
 * context changes mid-mount (e.g., a wizard's `connectionId` flips from
 * A to B), the existing breadcrumb would still hold A-connection IDs and
 * the next fetch would likely return empty. Callers must force a remount
 * via React `key` when identity changes:
 *
 * ```tsx
 * <CategoryTreeBrowser key={connectionId} ... />
 * ```
 *
 * Today's two consumers (CategoryPicker in listings, AllegroCategorySearch
 * in mappings) both live inside modals that unmount+remount per open, so
 * they don't hit this in practice — but the contract is explicit so a
 * future third consumer doesn't silently trip on it.
 *
 * @module apps/web/src/shared/ui
 */
import { forwardRef, useState, type ReactElement } from 'react';
import { Button } from './button';
import { LoadingState, ErrorState, EmptyState } from './feedback-state';

/**
 * Minimal node shape the primitive needs. Structurally compatible with
 * `AllegroCategory` from `features/mappings/api/mappings.types`, but
 * deliberately defined here so `shared/ui/` stays free of `features/`
 * imports (frontend-architecture.md §Dependency Rules).
 */
export interface CategoryTreeNode {
  id: string;
  name: string;
  leaf: boolean;
  parentId: string | null;
}

export interface CategoryTreeCrumb {
  id: string;
  name: string;
}

/**
 * Joins a breadcrumb + a selected node into a display path like `"A > B > C"`.
 * Exported so consumers don't drift on separator or ordering when composing
 * the path from `onSelect`'s callback args.
 */
export function buildCategoryPath(
  breadcrumb: readonly CategoryTreeCrumb[],
  node: CategoryTreeNode,
  separator = ' > ',
): string {
  return [...breadcrumb.map((c) => c.name), node.name].join(separator);
}

export interface CategoryTreeBrowserProps {
  /** Current level's nodes; `undefined` while the consumer's query is loading. */
  nodes: readonly CategoryTreeNode[] | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Optional retry handler for the error-state Retry button. */
  onRetry?: () => void;

  /**
   * Fired when the operator selects a node (clicks its Select button).
   * `breadcrumb` is the path from root at the time of selection, excluding
   * the selected node itself — callers that need the full path string
   * should compose `[...breadcrumb.map(c => c.name), node.name].join(' > ')`.
   */
  onSelect: (node: CategoryTreeNode, breadcrumb: readonly CategoryTreeCrumb[]) => void;

  /**
   * Fired whenever the breadcrumb depth changes — drilling into a non-leaf,
   * jumping back via a crumb, or clicking Root. `parentId` is `undefined`
   * at the root level. Callers use this to change their query's parentId arg.
   */
  onNavigate: (parentId: string | undefined, breadcrumb: readonly CategoryTreeCrumb[]) => void;

  /** Highlights the matching node in the list; toggles its Select button to "Selected". */
  selectedId?: string | null;

  /**
   * Predicate controlling which nodes render a Select button. Default:
   * `(node) => node.leaf`. AllegroCategorySearch passes `() => true` to
   * allow any-level selection.
   */
  canSelect?: (node: CategoryTreeNode) => boolean;

  /**
   * Visual density. `compact` enables `overflow-x: auto` on the breadcrumb
   * and tightens spacing — used by the dialog-bounded wizard picker.
   */
  density?: 'default' | 'compact';

  disabled?: boolean;
  invalid?: boolean;

  /** Forwarded to the root `<div role="group">` for form-field integration. */
  id?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;

  /** Merged with the primitive's own classes (never overrides). */
  className?: string;
}

export const CategoryTreeBrowser = forwardRef<HTMLDivElement, CategoryTreeBrowserProps>(
  function CategoryTreeBrowser(
    {
      nodes,
      isLoading,
      error,
      onRetry,
      onSelect,
      onNavigate,
      selectedId,
      canSelect = (node) => node.leaf,
      density = 'default',
      disabled,
      invalid,
      id,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      'aria-invalid': ariaInvalid,
      className = '',
    },
    ref,
  ): ReactElement {
    const [breadcrumb, setBreadcrumb] = useState<CategoryTreeCrumb[]>([]);

    const isInvalid = Boolean(invalid) || Boolean(ariaInvalid);

    function navigateInto(node: CategoryTreeNode): void {
      const next: CategoryTreeCrumb[] = [...breadcrumb, { id: node.id, name: node.name }];
      setBreadcrumb(next);
      onNavigate(node.id, next);
    }

    function navigateToRoot(): void {
      setBreadcrumb([]);
      onNavigate(undefined, []);
    }

    function navigateToCrumb(index: number): void {
      // Keep crumbs 0..index inclusive; drop anything deeper.
      const next = breadcrumb.slice(0, index + 1);
      setBreadcrumb(next);
      onNavigate(next[next.length - 1]?.id, next);
    }

    function handleSelect(node: CategoryTreeNode): void {
      onSelect(node, breadcrumb);
    }

    const rootClasses = [
      'category-tree-browser',
      `category-tree-browser--density-${density}`,
      isInvalid ? 'category-tree-browser--invalid' : '',
      disabled ? 'category-tree-browser--disabled' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        ref={ref}
        className={rootClasses}
        role="group"
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={isInvalid || undefined}
      >
        <nav className="category-tree-browser__breadcrumb" aria-label="Category path">
          <button
            type="button"
            className="category-tree-browser__crumb"
            onClick={navigateToRoot}
            disabled={disabled || breadcrumb.length === 0}
          >
            Root
          </button>
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.id} className="category-tree-browser__crumb-group">
              <span className="category-tree-browser__separator" aria-hidden="true">
                ›
              </span>
              <button
                type="button"
                className="category-tree-browser__crumb"
                onClick={() => navigateToCrumb(i)}
                disabled={disabled || i === breadcrumb.length - 1}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="category-tree-browser__list-container">
          {isLoading && (
            <LoadingState
              liveRegion="off"
              title="Loading categories"
              message="Fetching categories…"
            />
          )}

          {error && (
            <ErrorState
              title="Unable to load categories"
              message={error.message}
              action={onRetry ? <Button onClick={onRetry}>Retry</Button> : undefined}
            />
          )}

          {nodes && nodes.length === 0 && !isLoading && !error && (
            <EmptyState
              liveRegion="off"
              title="No subcategories"
              message="This level has no children. Step back and pick a different branch."
            />
          )}

          {nodes && nodes.length > 0 && (
            <ul className="category-tree-browser__list" role="list">
              {nodes.map((node) => {
                const selectable = canSelect(node);
                const isSelected = selectable && node.id === selectedId;
                const itemClasses = [
                  'category-tree-browser__item',
                  node.leaf
                    ? 'category-tree-browser__item--leaf'
                    : 'category-tree-browser__item--non-leaf',
                  isSelected ? 'category-tree-browser__item--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <li key={node.id} className={itemClasses}>
                    <span className="category-tree-browser__name">{node.name}</span>
                    <span className="category-tree-browser__actions">
                      {!node.leaf && (
                        <Button
                          tone="ghost"
                          type="button"
                          onClick={() => navigateInto(node)}
                          disabled={disabled}
                          aria-label={`Browse into ${node.name}`}
                        >
                          Browse
                        </Button>
                      )}
                      {selectable && (
                        <Button
                          tone={isSelected ? 'secondary' : 'primary'}
                          type="button"
                          onClick={() => handleSelect(node)}
                          disabled={disabled}
                          aria-pressed={isSelected}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  },
);
