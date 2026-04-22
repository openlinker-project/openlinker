/**
 * CategoryPicker
 *
 * Leaf-only Allegro category picker for the create-offer wizard (#305).
 * Browses the Allegro category tree level-by-level with a breadcrumb trail;
 * clicking a leaf fires `onChange(id)` — no staged/save intermediate.
 *
 * Designed to be used inside an RHF `<Controller>` (not `register()`); see
 * usage in `CreateOfferWizard.tsx` Step 2.
 *
 * Data source: reuses `useAllegroCategoriesQuery` from the mappings feature
 * — this is a cross-feature import. It is intentional: the wizard already
 * imports from `products/` and `connections/`, and duplicating the hook
 * under listings would be worse. A future refactor (#304) will extract a
 * shared `CategoryTreeBrowser` primitive into `shared/ui/` once the
 * existing `AllegroCategorySearch` (mappings) and this picker are refactored
 * onto it together.
 *
 * Pre-fill fallback: when `value` is non-null and the operator hasn't
 * browsed yet, the picker shows the raw ID + a "Change" button instead of
 * trying to rehydrate the breadcrumb. Real ancestor-walk rehydration is a
 * follow-up tied to #307's retry flow.
 *
 * @module apps/web/src/features/listings/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { LoadingState, ErrorState, EmptyState } from '../../../shared/ui/feedback-state';
import { useAllegroCategoriesQuery } from '../../mappings/hooks/use-allegro-categories';
import type { AllegroCategory } from '../../mappings/api/mappings.types';

interface CategoryPickerProps {
  connectionId: string;
  value: string | null;
  onChange: (categoryId: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  /** Forwarded from `FormField` for `aria-describedby` wiring. */
  id?: string;
  /** Forwarded from `FormField`. */
  'aria-describedby'?: string;
  /** Forwarded from `FormField`. */
  'aria-invalid'?: boolean;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

export function CategoryPicker({
  connectionId,
  value,
  onChange,
  invalid,
  disabled,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: CategoryPickerProps): ReactElement {
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  // `showBrowser` flips on when: (a) no value is set (always browse), or
  // (b) the operator clicks "Change" on the pre-fill fallback row.
  const [showBrowser, setShowBrowser] = useState<boolean>(value === null);

  const currentParentId = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : undefined;
  const categoriesQuery = useAllegroCategoriesQuery(connectionId, currentParentId, showBrowser);

  const isInvalid = Boolean(invalid) || Boolean(ariaInvalid);

  // Pre-fill fallback: the operator opened the wizard with a pre-set categoryId
  // (e.g. via a future retry flow from #307). We can't show the breadcrumb
  // path without an extra API call, so we show the raw ID + a Change affordance.
  if (!showBrowser && value !== null) {
    return (
      <div
        className={['category-picker', 'category-picker--prefill'].join(' ')}
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-invalid={isInvalid || undefined}
      >
        <div className="category-picker__prefill">
          <span className="category-picker__prefill-label">Current category ID</span>
          <span className="mono-text">{value}</span>
          <Button
            tone="secondary"
            type="button"
            onClick={() => setShowBrowser(true)}
            disabled={disabled}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  function navigateInto(category: AllegroCategory): void {
    setBreadcrumb((prev) => [...prev, { id: category.id, name: category.name }]);
  }

  function navigateTo(index: number): void {
    // index -1 → back to root; 0+ → keep first N crumbs
    setBreadcrumb((prev) => prev.slice(0, index + 1));
  }

  function selectLeaf(category: AllegroCategory): void {
    onChange(category.id);
  }

  const pickerClasses = [
    'category-picker',
    isInvalid ? 'category-picker--invalid' : '',
    disabled ? 'category-picker--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={pickerClasses}
      id={id}
      aria-describedby={ariaDescribedBy}
      aria-invalid={isInvalid || undefined}
    >
      <nav className="category-picker__breadcrumb" aria-label="Category path">
        <button
          type="button"
          className="category-picker__crumb"
          onClick={() => navigateTo(-1)}
          disabled={disabled || breadcrumb.length === 0}
        >
          Root
        </button>
        {breadcrumb.map((crumb, i) => (
          <span key={crumb.id} className="category-picker__crumb-group">
            <span className="category-picker__separator" aria-hidden="true">
              ›
            </span>
            <button
              type="button"
              className="category-picker__crumb"
              onClick={() => navigateTo(i)}
              disabled={disabled || i === breadcrumb.length - 1}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="category-picker__list-container">
        {categoriesQuery.isLoading && (
          <LoadingState
            liveRegion="off"
            title="Loading categories"
            message="Fetching Allegro categories…"
          />
        )}

        {categoriesQuery.error && (
          <ErrorState
            title="Unable to load categories"
            message={categoriesQuery.error.message}
            action={
              <Button onClick={() => void categoriesQuery.refetch()}>Retry</Button>
            }
          />
        )}

        {categoriesQuery.data && categoriesQuery.data.length === 0 && (
          <EmptyState
            liveRegion="off"
            title="No subcategories"
            message="This level has no children. Step back and pick a different branch."
          />
        )}

        {categoriesQuery.data && categoriesQuery.data.length > 0 && (
          <ul className="category-picker__list" role="list">
            {categoriesQuery.data.map((cat) => {
              const isSelected = cat.leaf && cat.id === value;
              const itemClasses = [
                'category-picker__item',
                cat.leaf ? 'category-picker__item--leaf' : 'category-picker__item--non-leaf',
                isSelected ? 'category-picker__item--selected' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <li key={cat.id} className={itemClasses}>
                  <span className="category-picker__name">{cat.name}</span>
                  {cat.leaf ? (
                    <Button
                      tone={isSelected ? 'secondary' : 'primary'}
                      type="button"
                      onClick={() => selectLeaf(cat)}
                      disabled={disabled}
                      aria-pressed={isSelected}
                    >
                      {isSelected ? 'Selected' : 'Select'}
                    </Button>
                  ) : (
                    <Button
                      tone="ghost"
                      type="button"
                      onClick={() => navigateInto(cat)}
                      disabled={disabled}
                      aria-label={`Browse into ${cat.name}`}
                    >
                      Browse →
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
