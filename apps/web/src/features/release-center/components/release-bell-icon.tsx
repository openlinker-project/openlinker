/**
 * Release bell icon (#4148)
 *
 * A hand-drawn bell instead of an emoji, so it keeps the product's own look
 * and inherits `currentColor`. A ship's-bell dome with a flared lip, a small
 * crown knob and a clapper that swings on its own while the bell rings; two
 * sound arcs on the right appear only while ringing (CSS, off under
 * `prefers-reduced-motion`).
 *
 * @module features/release-center/components
 */
import type { ReactElement } from 'react';

export function ReleaseBellIcon(): ReactElement {
  return (
    <svg
      className="release-bell-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        className="release-bell-icon__crown"
        cx="11"
        cy="3.4"
        r="1.1"
        fill="currentColor"
        stroke="none"
      />
      <path
        className="release-bell-icon__body"
        d="M11 4.8c-3.1 0-5.2 2.3-5.2 5.4v2.6c0 1.5-.5 2.6-1.6 3.8h13.6c-1.1-1.2-1.6-2.3-1.6-3.8v-2.6c0-3.1-2.1-5.4-5.2-5.4Z"
      />
      <path className="release-bell-icon__lip" d="M3.6 17.2h14.8" />
      <circle
        className="release-bell-icon__clapper"
        cx="11"
        cy="19.9"
        r="1.35"
        fill="currentColor"
        stroke="none"
      />
      <path
        className="release-bell-icon__wave release-bell-icon__wave--near"
        d="M18.6 8.2c.9.9 1.4 2 1.4 3.3"
      />
      <path
        className="release-bell-icon__wave release-bell-icon__wave--far"
        d="M20.8 6.4c1.4 1.5 2.2 3.3 2.2 5.1"
      />
    </svg>
  );
}
