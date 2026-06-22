/**
 * CheckboxCell
 *
 * Tri-state selection checkbox for `DataTable` multi-select (header = all/some/none,
 * rows = all/none). Renders a native `<input type="checkbox">` so it inherits the
 * platform a11y + keyboard behavior; the `some` state drives the DOM `indeterminate`
 * property (not expressible in JSX, hence the ref). Stops click/change from bubbling
 * to a row-click handler.
 *
 * Lifted from products-list-page (#739) to `shared/ui` for reuse by the bulk
 * shipment-dispatch selection (#1109).
 */
import type { ChangeEvent, ReactElement } from 'react';

export interface CheckboxCellProps {
  state: 'all' | 'some' | 'none';
  onToggle: () => void;
  disabled?: boolean;
  ariaLabel: string;
  tooltip?: string;
}

export function CheckboxCell({
  state,
  onToggle,
  disabled = false,
  ariaLabel,
  tooltip,
}: CheckboxCellProps): ReactElement {
  return (
    <input
      type="checkbox"
      checked={state === 'all'}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some';
      }}
      disabled={disabled}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        onToggle();
      }}
      // Stop click from bubbling to a row-click handler if a parent sets one.
      onClick={(e) => {
        e.stopPropagation();
      }}
      aria-label={ariaLabel}
      title={tooltip}
    />
  );
}
