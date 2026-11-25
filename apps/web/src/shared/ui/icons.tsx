/**
 * Icons
 *
 * The few glyphs the shared primitives draw themselves. The project has no icon
 * library: each icon is a small inline SVG on a 16 px grid that takes its colour
 * from `currentColor`, the way `BuyerNoteIcon` and the density toggle already
 * do. Decorative by default (`aria-hidden`); the element that holds one carries
 * the accessible name.
 *
 * @module shared/ui
 */
import type { ReactElement } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

function Glyph({
  size = 16,
  className,
  children,
}: IconProps & { children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A triangle with an exclamation mark: something to read before going on. */
export function WarningIcon(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M8 2.2 14.2 13H1.8z" />
      <path d="M8 6.4v3" />
      <path d="M8 11.3v.1" />
    </Glyph>
  );
}

/** A circle with an "i": background information. */
export function InfoIcon(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6" />
      <path d="M8 4.9v.1" />
    </Glyph>
  );
}
