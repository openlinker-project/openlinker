/**
 * CappedBadges (#4026, shared by #4027)
 *
 * A cell stack that shows at most three of its rendered children; past that it
 * shows the first two plus "+N more", whose click opens the row's side panel
 * where everything is listed. Badge components decide for themselves whether
 * they render (most return `null` on a healthy row), so the cap counts what
 * actually reached the DOM rather than predicting it.
 *
 * @module shared/ui
 */
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useMessages } from '../i18n/use-messages';
import { interpolate } from '../i18n/interpolate';

const VISIBLE = 2;
const MORE_CLASS = 'capped-badges__more';

export interface CappedBadgesProps {
  children: ReactNode;
  onMore: () => void;
  align?: 'start' | 'end';
}

export function CappedBadges({ children, onMore, align = 'start' }: CappedBadgesProps): ReactElement {
  const copy = useMessages('ui').cappedBadges;
  const ref = useRef<HTMLSpanElement>(null);
  const [hidden, setHidden] = useState(0);

  // After every render: the children can change without a cheap identity test.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const count = el.querySelectorAll(`:scope > :not(.${MORE_CLASS})`).length;
    const next = count > VISIBLE + 1 ? count - VISIBLE : 0;
    setHidden((prev) => (prev === next ? prev : next));
  });

  return (
    <span
      ref={ref}
      className={['capped-badges', align === 'end' ? 'capped-badges--end' : ''].filter(Boolean).join(' ')}
      data-capped={hidden > 0 ? 'true' : undefined}
    >
      {children}
      {hidden > 0 ? (
        <button type="button" className={MORE_CLASS} title={copy.moreTitle} onClick={onMore}>
          {interpolate(copy.more, { n: String(hidden) })}
        </button>
      ) : null}
    </span>
  );
}

export interface PeekArrowProps {
  /** Accessible name, e.g. "Open details for order 1042". */
  label: string;
  onOpen: () => void;
}

/**
 * The trailing row control that opens the row's side panel: a small round
 * button whose chevron points where the panel comes from. Pair it with a
 * pinned last column (`stickyRightColumns`) and the `list-table--fixed` table
 * class, which centres it and drives its hover motion.
 */
export function PeekArrow({ label, onOpen }: PeekArrowProps): ReactElement {
  return (
    <button type="button" className="peek-arrow" aria-label={label} onClick={onOpen}>
      <span className="peek-arrow__chevron" aria-hidden="true" />
    </button>
  );
}
