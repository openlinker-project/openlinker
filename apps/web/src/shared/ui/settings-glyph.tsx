/**
 * SettingsGlyph (#4154)
 *
 * The small stroke icons of the settings index, drawn on the same 16px grid and
 * stroke weight as the release center icons so the two feel like one set. The
 * project carries no icon library; inline paths are its convention. Decorative:
 * the row that holds one carries the accessible name.
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

const PATHS: Record<SettingsGlyphName, ReactNode> = {
  chart: <path d="M3 13V3M3 13h10M6 10V8M9 10V5.5M12 10V7" />,
  coins: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M9.8 6.3A2.3 2.3 0 0 0 8 5.5c-1.1 0-2 .6-2 1.5s.9 1.2 2 1.5 2 .6 2 1.5-.9 1.5-2 1.5a2.3 2.3 0 0 1-1.8-.8M8 4v1.5M8 10.5V12" />
    </>
  ),
  document: <path d="M4 2h5l3 3v9H4zM9 2v3h3M6 8h4M6 10.5h4" />,
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="2.5" />
      <path d="M7.3 8.7L13 3M11 5l2 2" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2.5 5l5.5 4 5.5-4" />
    </>
  ),
  pin: (
    <>
      <path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14Z" />
      <circle cx="8" cy="6.5" r="1.5" />
    </>
  ),
  route: (
    <>
      <circle cx="4" cy="3.5" r="1.4" />
      <circle cx="4" cy="12.5" r="1.4" />
      <circle cx="12" cy="6" r="1.4" />
      <path d="M4 4.9v6.2M4 9c0-1.7 1.3-3 3-3h3.6" />
    </>
  ),
  send: <path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2Z" />,
  sliders: (
    <>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </>
  ),
  sparkle: <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12 6.6 8.4 3 7l3.6-1.4L8 2Z" />,
  tag: (
    <>
      <path d="M2.5 8.2V3.5a1 1 0 0 1 1-1h4.7l5.3 5.3a1 1 0 0 1 0 1.4l-4.3 4.3a1 1 0 0 1-1.4 0z" />
      <circle cx="5.5" cy="5.5" r=".9" />
    </>
  ),
  users: (
    <>
      <circle cx="6" cy="5.5" r="2" />
      <path d="M2.5 13c0-2 1.6-3.5 3.5-3.5s3.5 1.5 3.5 3.5" />
      <circle cx="11.5" cy="6" r="1.6" />
      <path d="M10.7 9.7c2-.3 3.3.9 3.3 3.3" />
    </>
  ),
  window: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12" />
    </>
  ),
};

export function SettingsGlyph({
  name,
  size = 16,
}: {
  name: SettingsGlyphName;
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
