/**
 * View Icons
 *
 * The small stroke icons the views surfaces use, as one 16px grid, so the
 * strip, the menus and the Columns panel stay visually one set.
 *
 * @module apps/web/src/features/saved-views/components
 */
import type { ReactElement } from 'react';

const PATHS = {
  right: 'M6 3l5 5-5 5',
  plus: 'M8 3v10M3 8h10',
  x: 'M4 4l8 8M12 4l-8 8',
  sliders: 'M2 5h7M12 5h2M2 11h2M7 11h7M9 3v4M4 9v4',
  lock: 'M4 7V5a4 4 0 118 0v2M3 7h10v7H3z',
  up: 'M4 10l4-4 4 4',
  down: 'M4 6l4 4 4-4',
  grip: 'M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01',
  sort: 'M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5',
  dots: 'M3 8h.01M8 8h.01M13 8h.01',
  warn: 'M8 2l6.5 11.5h-13zM8 6.5v3.2M8 11.4v.01',
} as const;

export type ViewIconName = keyof typeof PATHS;

export function ViewIcon({ name, size = 14 }: { name: ViewIconName; size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
