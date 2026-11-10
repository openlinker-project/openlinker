/**
 * FilterDropdown + FilterGroup (#4026, shared by #4027)
 *
 * A pinned single-choice filter for a list toolbar. The button names the
 * applied value ("Source Allegro"); its popover lists the "any" choice and the
 * options with optional status dots and counts. Several sit side by side in a
 * `FilterGroup`, the joined button group that ends with the list's "Filters"
 * button.
 *
 * @module shared/ui
 */
import { useState, type ComponentPropsWithoutRef, type ReactElement } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type FilterOptionDot = 'error' | 'warning' | 'info' | 'success' | 'neutral';

export interface FilterOption<V extends string> {
  value: V;
  label: string;
  /** `undefined` while unknown: no count is shown rather than a 0. */
  count?: number;
  dot?: FilterOptionDot;
}

export interface FilterDropdownProps<V extends string> {
  label: string;
  anyLabel: string;
  value: V | null;
  options: readonly FilterOption<V>[];
  onChange: (next: V | null) => void;
}

export function FilterDropdown<V extends string>({
  label,
  anyLabel,
  value,
  options,
  onChange,
}: FilterDropdownProps<V>): ReactElement {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const choices: readonly (FilterOption<V> | { value: null; label: string; count?: undefined; dot?: undefined })[] =
    [{ value: null, label: anyLabel }, ...options];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={['joined-filters__btn', current ? 'joined-filters__btn--on' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {current ? (
            <>
              <span className="joined-filters__key">{label}</span>
              <span className="joined-filters__val">{current.label}</span>
            </>
          ) : (
            label
          )}
          <span className="joined-filters__caret" aria-hidden="true">
            {'⌄'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="choice-pop" aria-label={label}>
        {choices.map((o) => (
          <button
            key={o.value ?? '__any__'}
            type="button"
            className="choice-pop__opt"
            aria-pressed={value === o.value}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            <span className="choice-pop__mark" aria-hidden="true" />
            {o.dot ? <span className={`choice-pop__dot choice-pop__dot--${o.dot}`} aria-hidden="true" /> : null}
            {o.label}
            {o.count === undefined ? null : <span className="choice-pop__meta mono tabular">{o.count}</span>}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** The joined button group the dropdowns and the "Filters" button sit in. */
export function FilterGroup({ className = '', ...props }: ComponentPropsWithoutRef<'div'>): ReactElement {
  return (
    <div role="group" className={['joined-filters', className].filter(Boolean).join(' ')} {...props} />
  );
}
