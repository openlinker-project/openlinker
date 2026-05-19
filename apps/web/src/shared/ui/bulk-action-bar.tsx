/**
 * BulkActionBar
 *
 * Sticky action bar surfaced when an operator has multi-selected items on a
 * list page (#739 Products list is the first consumer). Renders a leading
 * tabular count + label and a trailing actions slot. Hidden via
 * `aria-hidden` when `count === 0`; consumers can also conditionally render.
 *
 * Listed in `docs/frontend-ui-style-guide.md § Core Component Patterns`.
 *
 * @module apps/web/src/shared/ui
 */
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

export interface BulkActionBarProps extends ComponentPropsWithoutRef<'div'> {
  /** Number currently selected. The bar is visually hidden when 0. */
  count: number;
  /** Singular form of the entity ("product", "row"). Defaults to "item". */
  itemNoun?: string;
  /** Optional hint shown next to the count (e.g. "Max 100 per batch"). */
  hint?: ReactNode;
  /** Trailing actions slot — typically a Clear ghost button + a primary CTA. */
  actions: ReactNode;
}

export const BulkActionBar = forwardRef<HTMLDivElement, BulkActionBarProps>(
  function BulkActionBar(
    { count, itemNoun = 'item', hint, actions, className = '', ...rest },
    ref,
  ) {
    const visible = count > 0;
    const classes = [
      'bulk-action-bar',
      visible ? '' : 'bulk-action-bar--hidden',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    const noun = count === 1 ? itemNoun : `${itemNoun}s`;

    return (
      <div
        ref={ref}
        className={classes}
        role="region"
        aria-label={visible ? `${count.toLocaleString()} ${noun} selected` : undefined}
        aria-hidden={!visible}
        {...rest}
      >
        <div className="bulk-action-bar__count">
          <strong className="bulk-action-bar__num tabular" aria-live="polite">
            {count.toLocaleString()}
          </strong>
          <span className="bulk-action-bar__label">selected</span>
        </div>
        {hint !== undefined && hint !== null ? (
          <div className="bulk-action-bar__hint">{hint}</div>
        ) : null}
        <div className="bulk-action-bar__actions">{actions}</div>
      </div>
    );
  },
);
