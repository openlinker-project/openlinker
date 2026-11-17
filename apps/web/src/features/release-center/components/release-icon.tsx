/**
 * Release center icons
 *
 * The small stroke icons the release surfaces use (close, arrows, archive,
 * undo, ...), drawn on one 16px grid so every control of the feature shares the
 * same weight. Decorative: the control that holds one carries the accessible name.
 *
 * @module features/release-center/components
 */
import type { ReactElement, ReactNode } from 'react';

export type ReleaseIconName =
  | 'archive'
  | 'arrow-left'
  | 'arrow-right'
  | 'check'
  | 'chevron'
  | 'close'
  | 'dots'
  | 'list'
  | 'sparkle'
  | 'trash'
  | 'undo';

const PATHS: Record<ReleaseIconName, ReactNode> = {
  archive: (
    <>
      <rect x="2" y="3" width="12" height="3.5" rx="1" />
      <path d="M3 6.5V12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.5M6.5 9h3" />
    </>
  ),
  'arrow-left': <path d="M13 8H3M7 4L3 8l4 4" />,
  'arrow-right': <path d="M3 8h10M9 4l4 4-4 4" />,
  check: <path d="M3 8.5l3.2 3.2L13 4.8" />,
  chevron: <path d="M4 6l4 4 4-4" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  dots: (
    <>
      <circle cx="3.5" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.5" cy="8" r="1" />
    </>
  ),
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />,
  sparkle: <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12 6.6 8.4 3 7l3.6-1.4L8 2Z" />,
  trash: (
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" />
  ),
  undo: <path d="M5 4L2.5 6.5 5 9M2.5 6.5H9a4 4 0 0 1 0 8H6" />,
};

export function ReleaseIcon({
  name,
  size = 16,
}: {
  name: ReleaseIconName;
  size?: number;
}): ReactElement {
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
      {PATHS[name]}
    </svg>
  );
}
