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
 * attribute is absent, so there is no flash before the effect runs).
 * ARIA radiogroup with roving tabindex and arrow/Home/End keys, like
 * ThemeToggle.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useMessages } from '../i18n/use-messages';

export const FontSizeValues = ['s', 'm', 'l', 'xl'] as const;
export type FontSize = (typeof FontSizeValues)[number];

const DEFAULT_FONT_SIZE: FontSize = 'm';
const STORAGE_KEY = 'openlinker-font-size';

interface FontSizeOption {
  value: FontSize;
  labelKey: 'small' | 'default' | 'large' | 'extraLarge';
  /** Glyph size inside the control, px. Deliberately fixed: it previews the step. */
  glyph: number;
}

const FONT_SIZE_OPTIONS: FontSizeOption[] = [
  { value: 's', labelKey: 'small', glyph: 10 },
  { value: 'm', labelKey: 'default', glyph: 12 },
  { value: 'l', labelKey: 'large', glyph: 14 },
  { value: 'xl', labelKey: 'extraLarge', glyph: 16 },
];

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

export function FontSizeToggle(): ReactElement {
  const [size, setSize] = useFontSize();
  const copy = useMessages('ui').fontSize;
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = FONT_SIZE_OPTIONS.findIndex((option) => option.value === size);

  // Stable ref callbacks: inline ones re-attach every render (see #461).
  const setOptionRef = useMemo(
    () =>
      FONT_SIZE_OPTIONS.map((_, index) => (el: HTMLButtonElement | null): void => {
        optionRefs.current[index] = el;
      }),
    [],
  );

  function moveTo(index: number): void {
    setSize(FONT_SIZE_OPTIONS[index].value);
    optionRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const total = FONT_SIZE_OPTIONS.length;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveTo((index - 1 + total) % total);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveTo((index + 1) % total);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(total - 1);
        break;
    }
  }

  return (
    <div
      className="font-size-toggle"
      role="radiogroup"
      aria-label={copy.group}
      style={{ '--fs-index': selectedIndex } as React.CSSProperties}
    >
      <span className="font-size-toggle__thumb" aria-hidden="true" />
      {FONT_SIZE_OPTIONS.map((option, index) => {
        const selected = option.value === size;
        return (
          <button
            key={option.value}
            ref={setOptionRef[index]}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={copy[option.labelKey]}
            title={copy[option.labelKey]}
            tabIndex={selected ? 0 : -1}
            className={`font-size-toggle__option ${selected ? 'is-active' : ''}`}
            onClick={() => setSize(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="font-size-toggle__glyph" style={{ fontSize: option.glyph }} aria-hidden="true">
              A
            </span>
          </button>
        );
      })}
    </div>
  );
}
