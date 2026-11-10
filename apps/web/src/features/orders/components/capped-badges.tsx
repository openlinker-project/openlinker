/**
 * CappedBadges (#4026)
 *
 * A cell stack that shows at most three of its rendered children; past that it
 * shows the first two plus "+N more", which opens the order peek where every
 * badge is listed. The badge components decide for themselves whether they
 * render (most return `null` for a healthy order), so the cap counts what
 * actually reached the DOM rather than predicting it.
 *
 * @module apps/web/src/features/orders/components
 */
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';

const VISIBLE = 2;
const MORE_CLASS = 'orders-capped__more';

export interface CappedBadgesProps {
  children: ReactNode;
  onMore: () => void;
  align?: 'start' | 'end';
}

export function CappedBadges({ children, onMore, align = 'start' }: CappedBadgesProps): ReactElement {
  const copy = useMessages('orders').peek;
  const ref = useRef<HTMLSpanElement>(null);
  const [hidden, setHidden] = useState(0);

  // Runs after every render: the children can change without this component's
  // props changing identity in a way React can compare cheaply.
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
      className={['orders-capped', align === 'end' ? 'orders-capped--end' : ''].filter(Boolean).join(' ')}
      data-capped={hidden > 0 ? 'true' : undefined}
    >
      {children}
      {hidden > 0 ? (
        <button
          type="button"
          className={MORE_CLASS}
          title={copy.moreBadgesTitle}
          onClick={onMore}
        >
          {interpolate(copy.moreBadges, { n: String(hidden) })}
        </button>
      ) : null}
    </span>
  );
}
