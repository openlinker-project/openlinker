/**
 * CategoryPicker
 *
 * Leaf-only Allegro category picker for the create-offer wizard (#305).
 * Thin wrapper around the shared `CategoryTreeBrowser` primitive — adds
 * the pre-fill fallback row, wires leaf-only selection via `canSelect`,
 * and fires `onChange(id)` immediately on leaf click (no staging).
 *
 * Designed to be used inside an RHF `<Controller>` (not `register()`); see
 * usage in `CreateOfferWizard.tsx` Step 2.
 *
 * Data source: reuses `useAllegroCategoriesQuery` from the mappings
 * feature. The primitive itself is domain-agnostic; only this wrapper
 * knows about Allegro.
 *
 * Pre-fill fallback: when `value` is non-null and the operator hasn't
 * browsed yet, the wrapper shows the raw ID + a "Change" button instead
 * of trying to rehydrate the breadcrumb. Real ancestor-walk rehydration
 * is a follow-up tied to #307's retry flow.
 *
 * @module apps/web/src/features/listings/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { CategoryTreeBrowser } from '../../../shared/ui/category-tree-browser';
import { useAllegroCategoriesQuery } from '../../mappings';

interface CategoryPickerProps {
  connectionId: string;
  value: string | null;
  onChange: (categoryId: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  /** Forwarded from `FormField` for `aria-describedby` wiring. */
  id?: string;
  /**
   * Required for a11y when the picker is used as a form control — the root
   * container is a `<div role="group">`, so screen readers need an external
   * label reference to announce the field name. Pass the `id` of the
   * `.form-field__label` element above the picker.
   */
  'aria-labelledby'?: string;
  /** Forwarded from `FormField`. */
  'aria-describedby'?: string;
  /** Forwarded from `FormField`. */
  'aria-invalid'?: boolean;
}

export function CategoryPicker({
  connectionId,
  value,
  onChange,
  invalid,
  disabled,
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: CategoryPickerProps): ReactElement {
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  // `showBrowser` flips on when: (a) no value is set (always browse), or
  // (b) the operator clicks "Change" on the pre-fill fallback row.
  const [showBrowser, setShowBrowser] = useState<boolean>(value === null);

  const categoriesQuery = useAllegroCategoriesQuery(connectionId, parentId, showBrowser);

  const isInvalid = Boolean(invalid) || Boolean(ariaInvalid);

  // Pre-fill fallback: the operator opened the wizard with a pre-set categoryId
  // (e.g. via a future retry flow from #307). We can't show the breadcrumb
  // path without an extra API call, so we show the raw ID + a Change affordance.
  if (!showBrowser && value !== null) {
    return (
      <div
        className={['category-picker', 'category-picker--prefill'].join(' ')}
        role="group"
        id={id}
        aria-labelledby={ariaLabelledBy}
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

  // The `key={connectionId}` honors the primitive's breadcrumb-reset contract:
  // if the wizard ever lets the operator switch connections without remounting
  // the picker, React key forces a fresh mount so stale breadcrumb state can't
  // linger. Today's wizard unmounts per open so this is defensive wiring.
  return (
    <CategoryTreeBrowser
      key={connectionId}
      nodes={categoriesQuery.data}
      isLoading={categoriesQuery.isLoading}
      error={categoriesQuery.error}
      onRetry={() => void categoriesQuery.refetch()}
      onSelect={(node) => onChange(node.id)}
      onNavigate={(pid) => setParentId(pid)}
      selectedId={value}
      canSelect={(node) => node.leaf}
      density="compact"
      disabled={disabled}
      invalid={isInvalid}
      id={id}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
    />
  );
}
