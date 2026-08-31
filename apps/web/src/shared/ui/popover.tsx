/**
 * Popover (Radix wrapper)
 *
 * The public surface is this wrapper; Radix is an implementation detail.
 *
 * **Where the content renders is the point** (#2537). `.data-table__container`
 * sets `overflow-x: auto`, so anything positioned inside a cell is clipped at
 * the table's edge - reproduced while building the sales-document mockup, where
 * a panel opened from the last column was cut in half. `PopoverContent` renders
 * into a portal at the document root, outside every clipping ancestor, and
 * Radix's collision handling then keeps it inside the viewport. A cell-anchored
 * popover therefore needs no positioning code of its own.
 *
 * A portal alone leaves one gap: the content is positioned once against the
 * trigger's rect, so scrolling the clipping ancestor slides the trigger away
 * from a panel that stays put. `dismissOnViewportChange` closes it instead of
 * chasing it, which is the right answer for a panel anchored to a row: the row
 * the operator opened it from is no longer where they are looking.
 *
 * @module shared/ui
 */
import * as RadixPopover from '@radix-ui/react-popover';
import {
  forwardRef,
  useCallback,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from 'react';

export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;
export const PopoverAnchor = RadixPopover.Anchor;

/** Marks our own content node, so the dismiss handler can ignore scrolls inside it. */
const CONTENT_SLOT = 'popover-content';

export interface PopoverProps extends ComponentPropsWithoutRef<typeof RadixPopover.Root> {
  /**
   * Close the popover when anything scrolls or the window resizes.
   *
   * Opt-in rather than the default: a popover anchored to a page-level control
   * (a filter, an infotip) should survive an incidental scroll, while one
   * anchored to a table row should not outlive the row's position. Both are
   * legitimate, so the caller says which it is.
   */
  dismissOnViewportChange?: boolean;
}

export function Popover({
  dismissOnViewportChange = false,
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: PopoverProps): ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  useEffect(() => {
    if (!dismissOnViewportChange || !isOpen) return undefined;

    const dismiss = (event: Event): void => {
      // A scroll inside the popover's own body is not the ancestor moving out
      // from under it, and closing on it would make a scrollable panel unusable.
      const target = event.target;
      if (
        event.type === 'scroll' &&
        target instanceof Element &&
        target.closest(`[data-slot="${CONTENT_SLOT}"]`) !== null
      ) {
        return;
      }
      setOpen(false);
    };

    // Capture, because a scroll event does not bubble: the clipping ancestor is
    // what moves, and only the capture path reaches the window from it.
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [dismissOnViewportChange, isOpen, setOpen]);

  return (
    <RadixPopover.Root {...props} open={isOpen} onOpenChange={setOpen}>
      {children}
    </RadixPopover.Root>
  );
}

export const PopoverContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixPopover.Content>
>(function PopoverContent(
  { className = '', sideOffset = 6, collisionPadding = 8, children, ...props },
  ref,
) {
  const classes = ['popover__content', className].filter(Boolean).join(' ');
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        ref={ref}
        data-slot={CONTENT_SLOT}
        className={classes}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
});
