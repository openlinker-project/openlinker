/**
 * SortMenu (#4026, shared by #4027)
 *
 * A list's sort keys as one menu: "Sort: Newest first ▼". Picking an entry
 * applies its own first-click direction; a direction flipped on a column header
 * reads back as "(reversed)". The default entry carries a quiet "default" mark.
 *
 * @module shared/ui
 */
import { useState, type ReactElement } from 'react';
import { useMessages } from '../i18n/use-messages';
import { interpolate } from '../i18n/interpolate';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type SortMenuDir = 'asc' | 'desc';

export interface SortMenuOption<K extends string> {
  key: K;
  label: string;
  /** The direction this entry applies. */
  dir: SortMenuDir;
}

export interface SortMenuProps<K extends string> {
  options: readonly SortMenuOption<K>[];
  value: K;
  dir: SortMenuDir;
  defaultKey: K;
  onChange: (key: K, dir: SortMenuDir) => void;
  'aria-label': string;
}

export function SortMenu<K extends string>({
  options,
  value,
  dir,
  defaultKey,
  onChange,
  'aria-label': ariaLabel,
}: SortMenuProps<K>): ReactElement {
  const copy = useMessages('ui').sortMenu;
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value) ?? options[0];
  const reversed = current ? dir !== current.dir : false;
  const label = current?.label ?? '';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button tone="ghost" className="button--sm" aria-label={ariaLabel}>
          {interpolate(reversed ? copy.buttonReversed : copy.button, { label })}
          <span className="joined-filters__caret" aria-hidden="true">
            {'▼'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="choice-pop choice-pop--sort" aria-label={ariaLabel}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className="choice-pop__opt"
            aria-pressed={o.key === value}
            onClick={() => {
              onChange(o.key, o.dir);
              setOpen(false);
            }}
          >
            <span className="choice-pop__mark" aria-hidden="true" />
            {o.label}
            {o.key === defaultKey ? <span className="choice-pop__meta">{copy.defaultMark}</span> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
