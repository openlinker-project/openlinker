/**
 * Motion presets
 *
 * The springs and entrance variants the switch primitives share (#4029), so
 * a popover, its list and its switch open alike wherever they are composed.
 *
 * @module shared/ui
 */

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
