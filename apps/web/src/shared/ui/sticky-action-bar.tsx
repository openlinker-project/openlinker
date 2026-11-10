/**
 * StickyActionBar
 *
 * The bar that slides up from the bottom of a form page while there are unsaved
 * changes: what changed on the left, undo and save on the right. It is out of
 * the tab order and hidden from assistive tech while clean, so a page with
 * nothing to save has no dead controls in it.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export interface StickyActionBarProps {
  /** Shown while there are unsaved changes. */
  visible: boolean;
  message: ReactNode;
  children: ReactNode;
  'aria-label'?: string;
}

export function StickyActionBar({
  visible,
  message,
  children,
  'aria-label': ariaLabel,
}: StickyActionBarProps): ReactElement {
  return (
    <div
      className="sticky-action-bar"
      data-clean={visible ? 'false' : 'true'}
      role="region"
      aria-label={ariaLabel}
      aria-hidden={visible ? undefined : true}
      // Takes the hidden bar's buttons out of the tab order.
      inert={!visible}
    >
      <span className="sticky-action-bar__message">{message}</span>
      <div className="sticky-action-bar__actions">{children}</div>
    </div>
  );
}
