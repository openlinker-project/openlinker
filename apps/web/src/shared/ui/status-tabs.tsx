/**
 * StatusTabs (#4026, shared by #4027)
 *
 * One status axis of a list page as tabs: a label, an optional status dot and a
 * count chip per tab, an underline that slides to the selected tab, and arrow
 * keys that move the selection (roving tabindex). Error and warning counts are
 * tinted; a zero count is muted; an unknown count (`undefined`) reads as a dash,
 * never as 0.
 *
 * On a narrow screen the row scrolls sideways. A fade and a chevron button
 * appear on whichever edge still hides tabs and disappear at the end the row
 * reached; the selected tab is kept in view.
 *
 * @module shared/ui
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useMessages } from '../i18n/use-messages';

export type StatusTabTone = 'error' | 'warning' | 'info' | 'success';

export interface StatusTab<K extends string> {
  /** `null` is the "all" tab. */
  key: K | null;
  label: string;
  tone?: StatusTabTone | null;
  /** `undefined` while unknown: rendered as a dash, never as 0. */
  count?: number;
}

export interface StatusTabsProps<K extends string> {
  tabs: readonly StatusTab<K>[];
  value: K | null;
  onChange: (next: K | null) => void;
  'aria-label': string;
  /**
   * Plain section tabs with no count chips. For a page that switches views or
   * jumps between sections, where a count would be a number nobody asked for.
   */
  hideCounts?: boolean;
}

export function StatusTabs<K extends string>({
  tabs,
  value,
  onChange,
  'aria-label': ariaLabel,
  hideCounts = false,
}: StatusTabsProps<K>): ReactElement {
  const copy = useMessages('ui').statusTabs;
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ x: 0, w: 0 });
  const [edges, setEdges] = useState({ left: false, right: false });

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el) return;
    setIndicator((prev) =>
      prev.x === el.offsetLeft && prev.w === el.offsetWidth ? prev : { x: el.offsetLeft, w: el.offsetWidth },
    );
  });

  const measureEdges = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    measureEdges();
    const observer = new ResizeObserver(measureEdges);
    observer.observe(el);
    if (listRef.current) observer.observe(listRef.current);
    return () => {
      observer.disconnect();
    };
  }, [measureEdges]);

  // Keep the selected tab visible: a deep link to the last tab must not open
  // with the selection scrolled out of sight.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  const scrollBy = (direction: -1 | 1): void => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: reduce ? 'auto' : 'smooth' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = tabs.findIndex((t) => t.key === value);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.key);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    });
  };

  return (
    <div
      className="status-tabs-frame"
      data-scroll-left={edges.left ? 'true' : undefined}
      data-scroll-right={edges.right ? 'true' : undefined}
    >
      <button
        type="button"
        className="status-tabs__nudge status-tabs__nudge--left"
        aria-label={copy.scrollLeft}
        tabIndex={-1}
        onClick={() => {
          scrollBy(-1);
        }}
      >
        <span className="status-tabs__nudge-dot" aria-hidden="true">
          <span className="status-tabs__chevron" />
        </span>
      </button>
      <div ref={scrollRef} className="status-tabs-scroll" onScroll={measureEdges}>
        <div
          ref={listRef}
          className="status-tabs"
          role="tablist"
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
        >
          {tabs.map((tab) => {
            const on = tab.key === value;
            const count = tab.count;
            const countClass = [
              'status-tab__count',
              count === 0
                ? 'status-tab__count--zero'
                : tab.tone === 'error' || tab.tone === 'warning'
                  ? `status-tab__count--${tab.tone}`
                  : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={tab.key ?? '__all__'}
                type="button"
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                className="status-tab"
                data-tab={tab.key ?? 'all'}
                onClick={() => {
                  onChange(tab.key);
                }}
              >
                {tab.tone ? (
                  <span className={`status-tab__dot status-tab__dot--${tab.tone}`} aria-hidden="true" />
                ) : null}
                {tab.label}
                {hideCounts ? null : (
                  <span className={countClass}>{count === undefined ? copy.unknownCount : count}</span>
                )}
              </button>
            );
          })}
          <span
            className="status-tabs__indicator"
            style={{ width: indicator.w, transform: `translateX(${indicator.x}px)` }}
            aria-hidden="true"
          />
        </div>
      </div>
      <button
        type="button"
        className="status-tabs__nudge status-tabs__nudge--right"
        aria-label={copy.scrollRight}
        tabIndex={-1}
        onClick={() => {
          scrollBy(1);
        }}
      >
        <span className="status-tabs__nudge-dot" aria-hidden="true">
          <span className="status-tabs__chevron" />
        </span>
      </button>
    </div>
  );
}
