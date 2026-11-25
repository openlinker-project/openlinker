/**
 * useGuidedTabTravel (#4228)
 *
 * On a guided arrival, makes the tab list's underline the travelling object: a
 * temporary 2 px ink starts on the origin tab's underline and springs to the
 * target's, using transform only. While it travels the target's own underline is
 * hidden (CSS, keyed off `travelling`) and the hand-off at landing is a single
 * commit. Measuring uses the triggers' offsets inside the list, so the ink stays
 * correct while the list is scrolled on a phone.
 *
 * Reduced motion, or a missing origin/target, skips the ink: the tab is simply
 * active. `onSettled` is how the caller drops its guided flag; it fires after the
 * landing, or at once where nothing travels.
 *
 * @module features/connections/hooks
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { animate } from 'motion/react';
import { prefersMotion } from '../../../shared/ui/prefers-motion';
import {
  announceGuidedLanded,
  computeInkTravel,
  GUIDED_INK_SPRING,
  GUIDED_SETTLE_MS,
  scrollLeftToReveal,
  tabDirection,
  type TabSpan,
} from '../lib/guided-jump';

interface UseGuidedTabTravelOptions {
  guided: boolean;
  fromTab: string | undefined;
  toTab: string;
  onSettled: () => void;
}

interface GuidedTabTravel {
  listRef: RefObject<HTMLDivElement | null>;
  inkRef: RefObject<HTMLSpanElement | null>;
  /** The ink to render, or null when nothing is travelling. */
  ink: { from: TabSpan; to: TabSpan } | null;
  /** Which side the incoming panel slides in from: 1 right, -1 left, 0 none. */
  direction: 1 | -1 | 0;
}

function spanOf(trigger: HTMLElement): TabSpan {
  return { left: trigger.offsetLeft, width: trigger.offsetWidth };
}

export function useGuidedTabTravel({
  guided,
  fromTab,
  toTab,
  onSettled,
}: UseGuidedTabTravelOptions): GuidedTabTravel {
  const listRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const [ink, setInk] = useState<GuidedTabTravel['ink']>(null);
  const [direction, setDirection] = useState<1 | -1 | 0>(0);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  const timers = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number): void => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useLayoutEffect(() => {
    if (!guided) return undefined;
    if (!prefersMotion()) {
      settledRef.current();
      return undefined;
    }
    const list = listRef.current;
    const triggers = list
      ? Array.from(list.querySelectorAll<HTMLElement>('[role="tab"][data-tab-value]'))
      : [];
    const order = triggers.map((t) => t.dataset.tabValue ?? '');
    setDirection(tabDirection(order, fromTab, toTab));
    const target = triggers.find((t) => t.dataset.tabValue === toTab);
    const origin = triggers.find((t) => t.dataset.tabValue === fromTab);
    if (!list || !target || !origin || origin === target) {
      // Nothing to travel between: the dialog chains to this instead of the ink.
      later(announceGuidedLanded, 450);
      later(() => settledRef.current(), 450 + GUIDED_SETTLE_MS);
      return () => timers.current.forEach(window.clearTimeout);
    }
    const to = spanOf(target);
    list.scrollLeft = scrollLeftToReveal(list, to);
    setInk({ from: spanOf(origin), to });
    return () => timers.current.forEach(window.clearTimeout);
  }, [guided, fromTab, toTab, later]);

  useEffect(() => {
    const el = inkRef.current;
    if (!ink || !el) return undefined;
    const travel = computeInkTravel(ink.from, ink.to);
    let landed = false;
    let cancelled = false;
    const land = (): void => {
      if (landed || cancelled) return;
      landed = true;
      setInk(null);
      announceGuidedLanded();
      later(() => settledRef.current(), GUIDED_SETTLE_MS);
    };
    const controls = animate(el, { x: travel.x, scaleX: travel.scaleX }, GUIDED_INK_SPRING);
    void controls.then(land, land);
    // The spring has a long tail; the underline is on its target well before it ends.
    later(land, 900);
    return () => {
      cancelled = true;
      controls.stop();
    };
  }, [ink, later]);

  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout);
    },
    []
  );

  return { listRef, inkRef, ink, direction };
}
