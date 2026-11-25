/**
 * Order header "See more" menu (#4286)
 *
 * Holds the secondary order actions. Its children keep their own buttons and
 * dialogs, so the panel stays MOUNTED while closed (hidden, not unmounted): an
 * open dialog must not vanish when the menu closes behind it. Closes on an
 * outside click and on Escape.
 *
 * @module apps/web/src/features/orders/components
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

export function OrderHeaderMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="order-header-menu" ref={rootRef}>
      <button
        type="button"
        className="button button--ghost button--sm order-header-menu__toggle"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); }}
      >
        {label}
      </button>
      <div className="order-header-menu__panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
