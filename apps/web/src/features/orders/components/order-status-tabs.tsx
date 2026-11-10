/**
 * OrderStatusTabs (#4026)
 *
 * The six health values as tabs, replacing the six clickable `MetricCard`s.
 * Same partition, same counts, same `health` URL filter: "All orders" carries
 * the total and the five health tabs sum to it. Arrow keys move between tabs
 * (roving tabindex); the underline slides to the selected tab.
 *
 * On a narrow screen the row scrolls sideways. A fade and a chevron button
 * appear on whichever edge still hides tabs, so the operator can tell the row
 * moves; they disappear at the end the row reached. The selected tab is kept
 * in view.
 *
 * @module apps/web/src/features/orders/components
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
import type { OrderHealthSummary, OrderHealthValue } from '../api/orders.types';
import { useMessages } from '../../../shared/i18n';

type TabTone = 'error' | 'warning' | 'info' | 'success';

interface HealthTab {
  key: OrderHealthValue | null;
  tone: TabTone | null;
  count: (summary: OrderHealthSummary) => number;
}

const TABS: readonly HealthTab[] = [
  { key: null, tone: null, count: (s) => s.total },
  { key: 'source_deleted', tone: 'error', count: (s) => s.sourceDeleted },
  { key: 'needs_attention', tone: 'error', count: (s) => s.needsAttention },
  { key: 'awaiting_mapping', tone: 'warning', count: (s) => s.awaitingMapping },
  { key: 'awaiting_dispatch', tone: 'info', count: (s) => s.awaitingDispatch },
  { key: 'synced', tone: 'success', count: (s) => s.synced },
];

export interface OrderStatusTabsProps {
  value: OrderHealthValue | undefined;
  summary: OrderHealthSummary | undefined;
  onChange: (next: OrderHealthValue | null) => void;
}

export function OrderStatusTabs({ value, summary, onChange }: OrderStatusTabsProps): ReactElement {
  const COPY = useMessages('orders').listFilters;
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ x: 0, w: 0 });
  const [edges, setEdges] = useState({ left: false, right: false });
  const selected = value ?? null;

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
  }, [selected]);

  const scrollBy = (direction: -1 | 1): void => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: reduce ? 'auto' : 'smooth' });
  };

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el) return;
    setIndicator((prev) =>
      prev.x === el.offsetLeft && prev.w === el.offsetWidth ? prev : { x: el.offsetLeft, w: el.offsetWidth },
    );
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.key === selected);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (!next) return;
    onChange(next.key);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    });
  };

  return (
    <div
      className="orders-tabs-frame"
      data-scroll-left={edges.left ? 'true' : undefined}
      data-scroll-right={edges.right ? 'true' : undefined}
    >
      <button
        type="button"
        className="orders-tabs__nudge orders-tabs__nudge--left"
        aria-label={COPY.scrollTabsLeft}
        tabIndex={-1}
        onClick={() => {
          scrollBy(-1);
        }}
      >
        <span className="orders-tabs__nudge-dot" aria-hidden="true">
          <span className="orders-tabs__chevron" />
        </span>
      </button>
      <div ref={scrollRef} className="orders-tabs-scroll" onScroll={measureEdges}>
      <div
        ref={listRef}
        className="orders-tabs"
        role="tablist"
        aria-label={COPY.statusTabsAria}
        onKeyDown={onKeyDown}
      >
        {TABS.map((tab) => {
          const on = tab.key === selected;
          const count = summary ? tab.count(summary) : undefined;
          const countClass = [
            'orders-tab__count',
            count === 0
              ? 'orders-tab__count--zero'
              : tab.tone === 'error' || tab.tone === 'warning'
                ? `orders-tab__count--${tab.tone}`
                : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={tab.key ?? 'all'}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className="orders-tab"
              data-health={tab.key ?? 'all'}
              onClick={() => {
                onChange(tab.key);
              }}
            >
              {tab.tone ? (
                <span className={`orders-tab__dot orders-tab__dot--${tab.tone}`} aria-hidden="true" />
              ) : null}
              {tab.key ? COPY.healthLabels[tab.key] : COPY.anyStatus}
              <span className={countClass}>{count === undefined ? '—' : count}</span>
            </button>
          );
        })}
        <span
          className="orders-tabs__indicator"
          style={{ width: indicator.w, transform: `translateX(${indicator.x}px)` }}
          aria-hidden="true"
        />
      </div>
      </div>
      <button
        type="button"
        className="orders-tabs__nudge orders-tabs__nudge--right"
        aria-label={COPY.scrollTabsRight}
        tabIndex={-1}
        onClick={() => {
          scrollBy(1);
        }}
      >
        <span className="orders-tabs__nudge-dot" aria-hidden="true">
          <span className="orders-tabs__chevron" />
        </span>
      </button>
    </div>
  );
}
