/**
 * SettingsGlyph (#4154)
 *
 * The icon family of the settings index. Original drawings, one visual rule:
 *
 *   - 24px grid, 1.5 stroke, round caps and joins, nothing outside a 3px margin;
 *   - every glyph keeps its upper-right corner open and docks ONE filled node
 *     (r 2, at 17.5 / 6.5) there, in the product accent. The node is the
 *     "live" part of the concept: the end of the trend, the chosen branch, the
 *     message that was just sent. Strokes stop short of it, so it reads as a
 *     cut-out, not as a sticker.
 *
 * The node takes `--settings-glyph-accent` (the accent by default) and falls
 * back to the current colour on a locked row. Decorative: the row that holds a
 * glyph carries the accessible name.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export type SettingsGlyphName =
  | 'chart'
  | 'coins'
  | 'document'
  | 'key'
  | 'mail'
  | 'pin'
  | 'route'
  | 'send'
  | 'sliders'
  | 'sparkle'
  | 'tag'
  | 'users'
  | 'window';

export const SETTINGS_GLYPH_NAMES: readonly SettingsGlyphName[] = [
  'sliders',
  'coins',
  'pin',
  'route',
  'document',
  'users',
  'tag',
  'mail',
  'send',
  'key',
  'window',
  'chart',
  'sparkle',
];

/** Strokes only; the shared accent node is added by the component. */
const PATHS: Record<SettingsGlyphName, ReactNode> = {
  // Sync pacing: three pulses getting taller, a rate rather than a dial.
  sliders: <path d="M5 20V16.5M10 20V13.25M15 20V10" />,
  // Currency: two overlapping discs, one value seen in two denominations.
  coins: (
    <>
      <circle cx="8.5" cy="15.5" r="5" />
      <circle cx="15" cy="15.5" r="5" />
    </>
  ),
  // Locations: bays in a rack, the first slot of the top row is the lit one.
  pin: (
    <>
      <rect x="3.5" y="3" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  // Sourcing rules: waypoints along a trail that ends at the chosen place.
  route: (
    <>
      <circle cx="5.5" cy="18.5" r="1.75" />
      <circle cx="11" cy="13" r="1.75" />
      <path d="M6.8 17.2L9.7 14.3M12.3 11.7L14.6 9.4" />
    </>
  ),
  // Sales documents routing: a sheet that is open at the corner a document leaves from.
  document: (
    <>
      <path d="M13.5 3.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-8" />
      <path d="M8.5 10h4M8.5 14h7M8.5 17.5h4.5" />
    </>
  ),
  // Who decides: the deciding point splits two ways; one branch reaches the live node.
  users: (
    <>
      <circle cx="6" cy="11" r="2" />
      <path d="M6 13v7.5M7.9 9.9l5.5-2.9M7.9 12.2l5.6 3.6" />
      <circle cx="15.4" cy="17.1" r="1.6" />
    </>
  ),
  // Order tags: a label with a string hole, a second one stacked under it.
  tag: (
    <>
      <path d="M5.5 10H14l5.5 4-5.5 4H5.5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
      <circle cx="7.6" cy="14" r="1" />
      <path d="M6 21h8" />
    </>
  ),
  // Buyer emails: a message bubble, the open corner is where it was sent from.
  mail: (
    <>
      <path d="M13.5 4.5H7.5a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3H8v3.5l4.2-3.5h4.3a3 3 0 0 0 3-3v-3" />
      <path d="M8.5 9.5h6M8.5 12.5h3.5" />
    </>
  ),
  // Mailer: an envelope, with the sent message hovering above it.
  send: (
    <>
      <rect x="3.5" y="11" width="17" height="10" rx="2.5" />
      <path d="M4.5 12.5l7.5 5.2 7.5-5.2" />
    </>
  ),
  // MCP tokens: a ticket with punched sides, the stub marked by a perforation.
  key: (
    <>
      <path d="M6.5 11h11a2 2 0 0 1 2 2v1.05a1.7 1.7 0 0 0 0 3.4v1.05a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-1.05a1.7 1.7 0 0 0 0-3.4V13a2 2 0 0 1 2-2Z" />
      <path d="M9.5 13.5v4.5" strokeDasharray="1.2 2.2" />
    </>
  ),
  // Login page: a password field, three dots typed and the caret waiting.
  window: (
    <>
      <rect x="3.5" y="11.5" width="17" height="8" rx="4" />
      <path d="M8 15.5h.01M11 15.5h.01M14 15.5h.01M17 14v3" />
    </>
  ),
  // Analytics: a trend that rises toward the latest point.
  chart: (
    <>
      <path d="M4 20.5h16" />
      <path d="M4.5 17.5l4-5 3.5 2.8 3.5-5.3" />
    </>
  ),
  // Release center: the previous version peeking out behind the new one.
  sparkle: (
    <>
      <path d="M3.5 17V8.5a3 3 0 0 1 3-3H11" />
      <rect x="7" y="10.5" width="13" height="10" rx="2.5" />
      <path d="M13.5 17.5v-4M11.5 15.3l2-2 2 2" />
    </>
  ),
};

export function SettingsGlyph({
  name,
  size = 22,
}: {
  name: SettingsGlyphName;
  size?: number;
}): ReactElement {
  return (
    <svg
      className="settings-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
      <circle className="settings-glyph__node" cx="17.5" cy="6.5" r="2" stroke="none" />
    </svg>
  );
}
