/**
 * Active Filter Chips (#3507)
 *
 * The `{label: value} ×` row the style guide's FilterBar pattern describes,
 * plus a trailing "Clear all". Renders nothing when no filter is active, so a
 * page can mount it unconditionally.
 *
 * Focus is managed on removal, because the button the user just pressed is
 * about to unmount: focus moves to the chip now at the same index (the next
 * one), else the previous one, else `onEmptyFocus` (typically the Filters
 * toggle). Without this, keyboard focus falls to `<body>` after every removal.
 *
 * @module shared/ui
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { BareIconButton } from './bare-icon-button';
import { Button } from './button';
import { FILTER_COPY } from './filter.copy';

export interface ActiveFilterChip {
  /** Stable identity (the filter key) — also the React key. */
  key: string;
  label: string;
  /** Rendered value; may be rich (a tag pill). */
  value: ReactNode;
  /** Plain-text value for the remove button's accessible name. */
  valueText: string;
  onRemove: () => void;
}

export interface ActiveFilterChipsProps {
  chips: readonly ActiveFilterChip[];
  onClearAll?: () => void;
  /** Called when the last chip is removed by keyboard, to park focus somewhere sensible. */
  onEmptyFocus?: () => void;
  'aria-label'?: string;
  clearAllLabel?: string;
  className?: string;
}

export function ActiveFilterChips({
  chips,
  onClearAll,
  onEmptyFocus,
  'aria-label': ariaLabel = FILTER_COPY.activeFiltersLabel,
  clearAllLabel = FILTER_COPY.clearAll,
  className = '',
}: ActiveFilterChipsProps): ReactElement | null {
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusIndex = useRef<number | null>(null);
  const keys = chips.map((c) => c.key).join('\u0000');

  useEffect(() => {
    const index = pendingFocusIndex.current;
    if (index === null) return;
    pendingFocusIndex.current = null;
    const target = chips[index] ?? chips[index - 1];
    if (target) {
      removeRefs.current.get(target.key)?.focus();
    } else {
      onEmptyFocus?.();
    }
    // Keyed on the chip identity list (`keys`, a stable fingerprint — the
    // `chips` array is a new object every render): focus must move exactly
    // once, after the removal has re-rendered the row.
  }, [keys]);

  if (chips.length === 0) return null;

  return (
    <div
      className={['active-filters', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={ariaLabel}
    >
      {chips.map((chip, index) => (
        <span key={chip.key} className="filter-chip" data-filter={chip.key}>
          <span className="filter-chip__label">{chip.label}</span>
          <span className="filter-chip__value">{chip.value}</span>
          <BareIconButton
            ref={(el) => {
              if (el) removeRefs.current.set(chip.key, el);
              else removeRefs.current.delete(chip.key);
            }}
            size="sm"
            label={FILTER_COPY.removeChip(chip.label, chip.valueText)}
            onClick={() => {
              pendingFocusIndex.current = index;
              chip.onRemove();
            }}
          />
        </span>
      ))}
      {onClearAll ? (
        <Button tone="ghost" className="button--xs active-filters__clear" onClick={onClearAll}>
          {clearAllLabel}
        </Button>
      ) : null}
    </div>
  );
}
