/**
 * MenuDrillIn
 *
 * One popover, several views: a row in the first view opens a second view
 * that glides in from the right while the first glides out to the left, and
 * the popover's height eases to the new view's height. Back reverses it. The
 * shape the account menu uses for its Appearance panel, instead of a side
 * flyout that has no room on a phone and covers the page on a desktop.
 *
 * How it stays robust inside the app's text-size `zoom`:
 *   - the height is read from a ResizeObserver (`borderBoxSize`, falling back
 *     to `offsetHeight`), which the CSS zoom spec keeps unscaled: the same
 *     css units the height is then written in, so the two agree whatever the
 *     zoom. Nothing here measures with getBoundingClientRect, the one
 *     geometry call that IS scaled and that misplaces things under zoom;
 *   - the leaving view is taken out of the flow (`position: absolute`) by
 *     itself through `useIsPresent`, not by Motion's `popLayout`, which
 *     measures boxes to do the same and would misplace them under zoom.
 *
 * Under reduced motion the views cross-fade in place and the height snaps.
 *
 * @module shared/ui
 */
import {
  AnimatePresence,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotionConfig,
  type Variants,
} from 'motion/react';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';

/** 1 = going deeper (the new view comes from the right), -1 = going back. */
export type MenuDrillDirection = 1 | -1;

export interface MenuDrillInProps {
  /** Identity of the view on show; changing it plays the slide. */
  viewKey: string;
  direction: MenuDrillDirection;
  children: ReactNode;
  className?: string;
  /**
   * How far the views travel, in px. A small region (a header) wants a
   * shorter move than a body of controls, or it reads as thrown.
   */
  shift?: number;
}

// Sized to a small popover (Emil Kowalski's 150-250ms band for menus, no
// overshoot): quick enough to read as the answer to the click, long enough to
// show where things went. Height and slide share one curve so they land
// together, as Firefox's panel does since it started animating its height.
const SLIDE = { type: 'spring', bounce: 0, visualDuration: 0.25 } as const;
const HEIGHT = { type: 'spring', bounce: 0, visualDuration: 0.25 } as const;
const FADE = { duration: 0.18, ease: [0.23, 1, 0.32, 1] } as const;

// A short move plus a fade, not the panel's full width: in a popover this
// narrow a full-width push reads heavy. The brief blur hides the moment the two
// views overlap.
const DEFAULT_SHIFT = 28;

function slideVariants(shift: number): Variants {
  return {
    enter: (direction: MenuDrillDirection) => ({
      x: direction * shift,
      opacity: 0,
      filter: 'blur(2px)',
    }),
    center: {
      x: 0,
      opacity: 1,
      filter: 'blur(0px)',
      transition: { x: SLIDE, opacity: FADE, filter: FADE },
    },
    exit: (direction: MenuDrillDirection) => ({
      x: direction * -shift,
      opacity: 0,
      filter: 'blur(2px)',
      transition: { x: SLIDE, opacity: { duration: 0.12 }, filter: { duration: 0.12 } },
    }),
  };
}

const FADE_VARIANTS: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: FADE },
  exit: { opacity: 0, transition: FADE },
};

function DrillView({
  variants,
  direction,
  onHeight,
  children,
}: {
  variants: Variants;
  direction: MenuDrillDirection;
  onHeight: (height: number) => void;
  children: ReactNode;
}): ReactElement {
  const present = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;

  // Only the view on show reports its height; the leaving one keeps quiet so
  // it cannot pull the popover back to its own size.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !present) return undefined;
    onHeightRef.current(node.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return undefined;
    // borderBoxSize is fractional (offsetHeight rounds, leaving a 1px settle)
    // and, like offsetHeight, unscaled by the zoom around it.
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.borderBoxSize?.[0]?.blockSize;
      onHeightRef.current(size ?? node.offsetHeight);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [present]);

  return (
    <motion.div
      ref={ref}
      className="menu-drill__view"
      data-leaving={present ? undefined : 'true'}
      variants={variants}
      custom={direction}
      initial="enter"
      animate="center"
      exit="exit"
      inert={!present}
    >
      {children}
    </motion.div>
  );
}

export function MenuDrillIn({
  viewKey,
  direction,
  children,
  className,
  shift = DEFAULT_SHIFT,
}: MenuDrillInProps): ReactElement {
  const still = useReducedMotionConfig() ?? false;
  const slide = useMemo(() => slideVariants(shift), [shift]);
  // The container's height is pinned to a number from the first measurement
  // on. Left at `auto` it would grow to the new view the instant it mounts,
  // leaving the animation nothing to animate from.
  const height = useMotionValue<number | 'auto'>('auto');
  const stillRef = useRef(still);
  stillRef.current = still;
  // Where the height is heading, so a repeat report of the same size (the
  // observer fires on every frame the view is still settling) does not restart
  // the spring.
  const target = useRef<number | null>(null);

  const onHeight = useCallback(
    (next: number): void => {
      if (target.current === next) return;
      target.current = next;
      const current = height.get();
      // First measurement, or reduced motion: no easing, the popover simply
      // opens (or switches) at the right size.
      if (typeof current !== 'number' || stillRef.current) {
        height.set(next);
        return;
      }
      void animate(height, next, HEIGHT);
    },
    [height]
  );

  return (
    <motion.div className={['menu-drill', className].filter(Boolean).join(' ')} style={{ height }}>
      <AnimatePresence initial={false} custom={direction}>
        <DrillView
          key={viewKey}
          variants={still ? FADE_VARIANTS : slide}
          direction={direction}
          onHeight={onHeight}
        >
          {children}
        </DrillView>
      </AnimatePresence>
    </motion.div>
  );
}
