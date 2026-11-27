/**
 * FontSizeToggle - interface text-size switch, sits beside Theme and Density.
 *
 * Persists to localStorage under `openlinker-font-size` and writes
 * `<html data-font-size="...">`. The scale itself is ONE `zoom` rule per
 * size in index.css (not a rewrite of the px/rem values): zoom scales
 * text, padding, radii and icons together, so the layout stays
 * proportional at every step.
 *
 * Four sizes; `m` is the default (and what the CSS applies when the
 * attribute is absent, so there is no flash before the effect runs). The
 * control is the shared `SegmentedSwitch`, so it looks and moves exactly
 * like the theme picker: a thumb springs to the chosen size, each icon is an
 * "A" drawn one step larger than the last.
 */
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useMessages } from '../i18n/use-messages';
import {
  SegmentedSwitch,
  type SegmentedSwitchOption,
  type SegmentedSwitchSize,
} from './segmented-switch';
export const FontSizeValues = ['s', 'm', 'l', 'xl'] as const;
export type FontSize = (typeof FontSizeValues)[number];

const DEFAULT_FONT_SIZE: FontSize = 'm';
const STORAGE_KEY = 'openlinker-font-size';

function isFontSize(value: unknown): value is FontSize {
  return typeof value === 'string' && (FontSizeValues as readonly string[]).includes(value);
}

function readPersisted(): FontSize {
  if (typeof window === 'undefined') return DEFAULT_FONT_SIZE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isFontSize(raw) ? raw : DEFAULT_FONT_SIZE;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

function applyFontSize(size: FontSize): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.fontSize = size;
}

export function useFontSize(): [FontSize, (next: FontSize) => void] {
  const [size, setSizeState] = useState<FontSize>(() => readPersisted());

  useEffect(() => {
    applyFontSize(size);
  }, [size]);

  const setSize = useCallback((next: FontSize) => {
    setSizeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable - the size still applies in-session.
    }
  }, []);

  return [size, setSize];
}

/** Letter height in the 16px icon box; the baseline is shared so the A's step up. */
const GLYPH_HEIGHT: Record<FontSize, number> = { s: 6, m: 8.5, l: 11, xl: 13.5 };
const LABEL_KEY = { s: 'small', m: 'default', l: 'large', xl: 'extraLarge' } as const;

function FontSizeIcon({ size }: { size: FontSize }): ReactElement {
  const height = GLYPH_HEIGHT[size];
  const base = 14.5;
  const half = height * 0.52;
  const bar = base - height * 0.36;
  return (
    <svg className="font-size-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={`M${8 - half} ${base}L8 ${base - height}L${8 + half} ${base}M${8 - half * 0.58} ${bar}H${8 + half * 0.58}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FontSizeToggle({ size: switchSize }: { size?: SegmentedSwitchSize } = {}): ReactElement {
  const [size, setSize] = useFontSize();
  const copy = useMessages('ui').fontSize;
  const options = useMemo<SegmentedSwitchOption<FontSize>[]>(
    () =>
      FontSizeValues.map((value) => ({
        value,
        label: copy[LABEL_KEY[value]],
        icon: createElement(FontSizeIcon, { size: value }),
        pressTurn: -8,
      })),
    [copy]
  );
  return (
    <SegmentedSwitch
      className="font-size-picker"
      options={options}
      value={size}
      onChange={setSize}
      labels="always"
      slideThumb
      size={switchSize}
      aria-label={copy.group}
    />
  );
}
