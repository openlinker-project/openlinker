/**
 * Motion presets
 *
 * The springs and entrance variants the switch primitives share (#4029), so
 * a popover, its list and its switch open alike wherever they are composed.
 *
 * @module shared/ui
 */
import type { TargetAndTransition } from 'motion/react';

/** Popovers, list rows, chevrons: quick and firm, no visible overshoot. */
export const SNAPPY_SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as const;

/** A selection thumb sliding to its option: a touch of bounce. */
export const THUMB_SPRING = { type: 'spring', bounce: 0.18, visualDuration: 0.32 } as const;

/** Children of a freshly opened surface come in one after another. */
export const ENTRANCE_GROUP = {
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } },
} as const;

/** Each child: a short slide from the left while it fades in. */
export const ENTRANCE_ITEM = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: SNAPPY_SPRING },
} as const;

/**
 * The open/close of a floating panel: scales up from 92%, drops a few pixels
 * from its trigger and sharpens out of a blur. `down` is a panel opening below
 * its trigger. `x` is set only by a caller that centres the panel with Motion's
 * transform (Motion owns `transform`, so CSS cannot).
 */
export function popoverEntrance(
  down: boolean,
  x?: string
): {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: typeof SNAPPY_SPRING;
} {
  const centre: TargetAndTransition = x === undefined ? {} : { x };
  return {
    initial: { opacity: 0, scale: 0.92, ...centre, y: down ? -6 : 6, filter: 'blur(4px)' },
    animate: { opacity: 1, scale: 1, ...centre, y: 0, filter: 'blur(0px)' },
    exit: {
      opacity: 0,
      scale: 0.96,
      ...centre,
      y: down ? -4 : 4,
      filter: 'blur(2px)',
      transition: { duration: 0.12 },
    },
    transition: SNAPPY_SPRING,
  };
}
