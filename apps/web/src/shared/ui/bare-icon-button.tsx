/**
 * Bare Icon Button
 *
 * A glyph-only button meant to live INSIDE another component — the `×` on a
 * tag pill or an active-filter chip (#3507). Every `<button>` inherits the
 * global button box (32 px tall, padded, bordered, shadowed); this primitive
 * opts out of all of it through `.button--bare`, so the host pill keeps its
 * own height. The accessible name is mandatory because the visible content is
 * a glyph, never words.
 *
 * @module shared/ui
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';

export type BareIconButtonSize = 'xs' | 'sm';

export interface BareIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Accessible name — the glyph alone says nothing to a screen reader. */
  label: string;
  /** `xs` = 16 px (tag pill), `sm` = 18 px (filter chip). */
  size?: BareIconButtonSize;
  /** Defaults to a multiplication sign, the remove glyph. */
  children?: ReactNode;
}

export const BareIconButton = forwardRef<HTMLButtonElement, BareIconButtonProps>(
  function BareIconButton(
    { label, size = 'xs', className = '', type = 'button', children = '×', ...props },
    ref,
  ): ReactElement {
    const classes = ['button--bare', size === 'sm' ? 'button--bare-sm' : '', className]
      .filter(Boolean)
      .join(' ');
    return (
      <button ref={ref} type={type} className={classes} aria-label={label} {...props}>
        <span aria-hidden="true">{children}</span>
      </button>
    );
  },
);
