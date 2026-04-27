/**
 * Combobox
 *
 * Virtualized combobox primitive for large dictionaries (Allegro `Marka` has
 * ~5000 entries). Composes `popover.tsx` (Radix) for portal + positioning and
 * implements the W3C combobox pattern with arrow-key navigation, filter-first
 * gating for large lists, and optional custom-value passthrough for fields
 * that allow both dictionary selection and free text.
 *
 * Design intent: refined cockpit minimalism. Typography carries the signal —
 * dictionary values in Plex Sans, IDs in mono muted, custom values in italic
 * mono. No decorative shadows, no hover transitions, no chromatic accents
 * beyond the focus ring. Selection indicator is a mono `→` glyph (Linear
 * direction style), not the generic admin checkmark.
 *
 * @module shared/ui
 * @see {@link Popover} for the underlying portal primitive
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface ComboboxOption {
  /** Stable id; what `value.ids` references for dictionary mode. */
  id: string;
  /** Human label rendered in Plex Sans. */
  label: string;
  /** Optional secondary metadata rendered in mono muted (e.g. dict id). */
  hint?: string;
  /** Visually disabled (e.g. filtered out by parent dependency). Still searchable. */
  disabled?: boolean;
  /** Tooltip / aria-description when disabled. */
  disabledReason?: string;
}

export type ComboboxValue =
  | { kind: 'dictionary'; ids: string[] }
  | { kind: 'custom'; text: string };

export interface ComboboxProps {
  options: ComboboxOption[];
  value: ComboboxValue | null;
  onChange: (next: ComboboxValue | null) => void;
  /** Single-select returns `{ kind: 'dictionary', ids: [id] }`. Multi returns the array. */
  mode?: 'single' | 'multi';
  /** When true, free-text input that doesn't match any option commits as `{ kind: 'custom', text }`. */
  allowCustomValues?: boolean;
  /** Threshold for filter-first: when options.length >= threshold, no options render until the user types. */
  filterFirstThreshold?: number;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** FormField wiring. */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  /** When the parent doesn't provide a `<label>` (i.e. not inside FormField). */
  ariaLabel?: string;
  /** Class merge slot. */
  className?: string;
  /** For test introspection. */
  'data-testid'?: string;
}

const DEFAULT_FILTER_FIRST_THRESHOLD = 50;
const VIRTUALIZE_THRESHOLD = 200;
const OPTION_ROW_HEIGHT = 32;
// Touch density (40px) is applied via CSS @media (pointer: coarse). The
// virtualizer estimate intentionally uses the desktop value — over-estimate
// on touch is harmless and the actual rendered row size drives scroll math.

export const Combobox = forwardRef<HTMLButtonElement, ComboboxProps>(function Combobox(
  {
    options,
    value,
    onChange,
    mode = 'single',
    allowCustomValues = false,
    filterFirstThreshold = DEFAULT_FILTER_FIRST_THRESHOLD,
    placeholder,
    disabled = false,
    invalid = false,
    id,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalidProp,
    ariaLabel,
    className = '',
    'data-testid': dataTestId,
  },
  ref,
): ReactElement {
  const generatedId = useId();
  const triggerId = id ?? `combobox-${generatedId}`;
  const listboxId = `${triggerId}-listbox`;
  const counterId = `${triggerId}-counter`;
  const searchId = `${triggerId}-search`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const optionsById = useMemo(() => {
    const map = new Map<string, ComboboxOption>();
    for (const opt of options) map.set(opt.id, opt);
    return map;
  }, [options]);

  const trimmed = query.trim();
  const filterFirst = options.length >= filterFirstThreshold;
  const showOptions = !filterFirst || trimmed.length > 0;

  const filteredOptions = useMemo(() => {
    if (!showOptions) return [];
    if (trimmed.length === 0) return options;
    const needle = trimmed.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, trimmed, showOptions]);

  const customMatch = useMemo(() => {
    if (!allowCustomValues || trimmed.length === 0) return null;
    const exact = options.find((o) => o.label.trim().toLowerCase() === trimmed.toLowerCase());
    return exact ? null : trimmed;
  }, [allowCustomValues, options, trimmed]);

  // Reset highlight when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [filteredOptions, customMatch]);

  // Determine current state for trigger label
  const selectedIds = value?.kind === 'dictionary' ? value.ids : [];
  const selectedCustom = value?.kind === 'custom' ? value.text : null;
  const triggerSummary = formatTriggerSummary(value, optionsById, placeholder);

  const listboxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredOptions.length + (customMatch ? 1 : 0),
    getScrollElement: () => listboxRef.current,
    estimateSize: () => OPTION_ROW_HEIGHT,
    overscan: 8,
    enabled: showOptions && filteredOptions.length >= VIRTUALIZE_THRESHOLD,
  });

  const useVirtual =
    showOptions && filteredOptions.length >= VIRTUALIZE_THRESHOLD;

  // Keep the highlighted option in view
  useEffect(() => {
    if (!open || !showOptions || !useVirtual) return;
    virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex, open, showOptions, useVirtual, virtualizer]);

  // Autofocus search on open
  useEffect(() => {
    if (open) {
      // Defer to next frame so the popover content is mounted
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setQuery('');
    }
  }, [open]);

  const totalRows = filteredOptions.length + (customMatch ? 1 : 0);

  const commitDictionary = useCallback(
    (optionId: string) => {
      if (mode === 'single') {
        onChange({ kind: 'dictionary', ids: [optionId] });
        setOpen(false);
      } else {
        const current = value?.kind === 'dictionary' ? value.ids : [];
        const next = current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
        onChange(next.length === 0 ? null : { kind: 'dictionary', ids: next });
      }
    },
    [mode, onChange, value],
  );

  const commitCustom = useCallback(
    (text: string) => {
      onChange({ kind: 'custom', text });
      if (mode === 'single') setOpen(false);
    },
    [mode, onChange],
  );

  const commitActive = useCallback(() => {
    if (!totalRows) return;
    if (customMatch && activeIndex === filteredOptions.length) {
      commitCustom(customMatch);
      return;
    }
    const opt = filteredOptions[activeIndex];
    if (opt && !opt.disabled) commitDictionary(opt.id);
  }, [activeIndex, commitCustom, commitDictionary, customMatch, filteredOptions, totalRows]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, totalRows - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(Math.max(totalRows - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitActive();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Backspace' && query.length === 0 && mode === 'multi' && selectedIds.length > 0) {
      // Quick remove last chip when typing into empty input
      const next = selectedIds.slice(0, -1);
      onChange(next.length === 0 ? null : { kind: 'dictionary', ids: next });
    }
  };

  const handleRemoveChip = (optionId: string): void => {
    const next = selectedIds.filter((id) => id !== optionId);
    onChange(next.length === 0 ? null : { kind: 'dictionary', ids: next });
  };

  const handleClearCustom = (): void => {
    onChange(null);
  };

  const triggerClasses = [
    'combobox__trigger',
    invalid || ariaInvalidProp ? 'combobox__trigger--invalid' : '',
    disabled ? 'combobox__trigger--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          id={triggerId}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={invalid || ariaInvalidProp}
          disabled={disabled}
          className={triggerClasses}
          data-testid={dataTestId}
        >
          {mode === 'multi' && selectedIds.length > 0 ? (
            <span className="combobox__chips">
              {selectedIds.slice(0, 3).map((selectedId) => {
                const opt = optionsById.get(selectedId);
                return (
                  <ChipPill
                    key={selectedId}
                    label={opt?.label ?? selectedId}
                    onRemove={() => handleRemoveChip(selectedId)}
                  />
                );
              })}
              {selectedIds.length > 3 ? (
                <span className="combobox__chip-more">+{selectedIds.length - 3} more</span>
              ) : null}
            </span>
          ) : selectedCustom ? (
            <span className="combobox__custom-value" title="Custom value (not from list)">
              {selectedCustom}
            </span>
          ) : (
            <span className="combobox__summary">{triggerSummary}</span>
          )}
          <ChevronGlyph />
        </button>
      </PopoverTrigger>

      <PopoverContent className="combobox__panel" sideOffset={4} align="start">
        <div className="combobox__panel-header">
          <input
            ref={searchRef}
            id={searchId}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="combobox__search"
            placeholder={
              allowCustomValues
                ? 'Type to search or enter a custom value…'
                : filterFirst
                  ? `Type to search ${options.length.toLocaleString()} options…`
                  : 'Type to filter…'
            }
            autoComplete="off"
            spellCheck={false}
            aria-controls={listboxId}
            aria-activedescendant={
              showOptions && totalRows > 0 ? `${listboxId}-row-${activeIndex}` : undefined
            }
          />
          <span className="combobox__counter" id={counterId} aria-live="polite">
            {!showOptions
              ? `${options.length.toLocaleString()} ${pluralize(options.length, 'option')}`
              : `Showing ${filteredOptions.length.toLocaleString()} of ${options.length.toLocaleString()}`}
          </span>
        </div>

        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-multiselectable={mode === 'multi'}
          className="combobox__listbox"
          tabIndex={-1}
        >
          {!showOptions ? (
            <EmptyHint text={`Type to search ${options.length.toLocaleString()} options.`} />
          ) : totalRows === 0 ? (
            <EmptyHint text={`No options match “${trimmed}”.`} />
          ) : useVirtual ? (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((vRow) => {
                const isCustomRow = customMatch && vRow.index === filteredOptions.length;
                if (isCustomRow) {
                  return (
                    <CustomMatchRow
                      key="custom"
                      style={{
                        position: 'absolute',
                        top: vRow.start,
                        left: 0,
                        right: 0,
                        height: vRow.size,
                      }}
                      text={customMatch}
                      active={activeIndex === vRow.index}
                      listboxId={listboxId}
                      onActivate={() => setActiveIndex(vRow.index)}
                      onCommit={() => commitCustom(customMatch)}
                    />
                  );
                }
                const opt = filteredOptions[vRow.index];
                return (
                  <OptionRow
                    key={opt.id}
                    option={opt}
                    queryHighlight={trimmed}
                    style={{
                      position: 'absolute',
                      top: vRow.start,
                      left: 0,
                      right: 0,
                      height: vRow.size,
                    }}
                    selected={selectedIds.includes(opt.id)}
                    active={activeIndex === vRow.index}
                    listboxId={listboxId}
                    rowIndex={vRow.index}
                    onActivate={() => setActiveIndex(vRow.index)}
                    onCommit={() => commitDictionary(opt.id)}
                  />
                );
              })}
            </div>
          ) : (
            <>
              {filteredOptions.map((opt, idx) => (
                <OptionRow
                  key={opt.id}
                  option={opt}
                  queryHighlight={trimmed}
                  selected={selectedIds.includes(opt.id)}
                  active={activeIndex === idx}
                  listboxId={listboxId}
                  rowIndex={idx}
                  onActivate={() => setActiveIndex(idx)}
                  onCommit={() => commitDictionary(opt.id)}
                />
              ))}
              {customMatch ? (
                <CustomMatchRow
                  text={customMatch}
                  active={activeIndex === filteredOptions.length}
                  listboxId={listboxId}
                  onActivate={() => setActiveIndex(filteredOptions.length)}
                  onCommit={() => commitCustom(customMatch)}
                />
              ) : null}
            </>
          )}
        </div>

        <div className="combobox__panel-footer">
          <span className="combobox__keyhint">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            <span>navigate</span>
            <span aria-hidden>·</span>
            <kbd>↵</kbd>
            <span>select</span>
            <span aria-hidden>·</span>
            <kbd>esc</kbd>
            <span>close</span>
          </span>
          {selectedCustom ? (
            <button
              type="button"
              className="combobox__clear"
              onClick={handleClearCustom}
            >
              Clear custom value
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
});

function formatTriggerSummary(
  value: ComboboxValue | null,
  optionsById: Map<string, ComboboxOption>,
  placeholder: string | undefined,
): string {
  if (!value) return placeholder ?? 'Select…';
  if (value.kind === 'custom') return value.text;
  if (value.ids.length === 1) {
    const opt = optionsById.get(value.ids[0]);
    return opt?.label ?? value.ids[0];
  }
  if (value.ids.length === 0) return placeholder ?? 'Select…';
  return `${value.ids.length} selected`;
}

function pluralize(n: number, word: string): string {
  return `${word}${n === 1 ? '' : 's'}`;
}

interface OptionRowProps {
  option: ComboboxOption;
  queryHighlight: string;
  selected: boolean;
  active: boolean;
  listboxId: string;
  rowIndex: number;
  onActivate: () => void;
  onCommit: () => void;
  style?: React.CSSProperties;
}

function OptionRow({
  option,
  queryHighlight,
  selected,
  active,
  listboxId,
  rowIndex,
  onActivate,
  onCommit,
  style,
}: OptionRowProps): ReactElement {
  const classes = [
    'combobox__option',
    selected ? 'combobox__option--selected' : '',
    active ? 'combobox__option--active' : '',
    option.disabled ? 'combobox__option--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      id={`${listboxId}-row-${rowIndex}`}
      role="option"
      aria-selected={selected}
      aria-disabled={option.disabled || undefined}
      className={classes}
      style={style}
      onMouseEnter={onActivate}
      onMouseDown={(e) => {
        e.preventDefault(); // prevent input blur
        if (!option.disabled) onCommit();
      }}
      title={option.disabled ? option.disabledReason : undefined}
    >
      <span className="combobox__option-arrow" aria-hidden>
        →
      </span>
      <span className="combobox__option-label">
        {highlightMatch(option.label, queryHighlight)}
      </span>
      {option.hint ? <span className="combobox__option-hint">{option.hint}</span> : null}
    </div>
  );
}

interface CustomMatchRowProps {
  text: string;
  active: boolean;
  listboxId: string;
  onActivate: () => void;
  onCommit: () => void;
  style?: React.CSSProperties;
}

function CustomMatchRow({
  text,
  active,
  listboxId,
  onActivate,
  onCommit,
  style,
}: CustomMatchRowProps): ReactElement {
  const classes = [
    'combobox__option',
    'combobox__option--custom',
    active ? 'combobox__option--active' : '',
  ].join(' ');
  return (
    <div
      id={`${listboxId}-row-custom`}
      role="option"
      aria-selected={false}
      className={classes}
      style={style}
      onMouseEnter={onActivate}
      onMouseDown={(e) => {
        e.preventDefault();
        onCommit();
      }}
    >
      <span className="combobox__option-arrow" aria-hidden>
        +
      </span>
      <span className="combobox__option-label">
        Use as custom value:&nbsp;
        <em className="combobox__option-custom-text">{text}</em>
      </span>
    </div>
  );
}

function highlightMatch(label: string, query: string): ReactElement {
  if (query.length === 0) return <>{label}</>;
  const lower = label.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return <>{label}</>;
  return (
    <>
      {label.slice(0, idx)}
      <mark className="combobox__match">{label.slice(idx, idx + query.length)}</mark>
      {label.slice(idx + query.length)}
    </>
  );
}

interface ChipPillProps {
  label: string;
  onRemove: () => void;
}

function ChipPill({ label, onRemove }: ChipPillProps): ReactElement {
  return (
    <span className="combobox__chip" data-chip>
      <span className="combobox__chip-label">{label}</span>
      <button
        type="button"
        className="combobox__chip-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}

function ChevronGlyph(): ReactElement {
  return (
    <svg
      className="combobox__chevron"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
      focusable="false"
    >
      <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface EmptyHintProps {
  text: string;
}

function EmptyHint({ text }: EmptyHintProps): ReactElement {
  return <div className="combobox__empty">{text}</div>;
}
