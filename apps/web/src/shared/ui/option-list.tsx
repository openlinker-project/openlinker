/**
 * OptionList
 *
 * A pick-one list for a popover (#4029): rows come in one after another
 * (`entrance`, off where the list is already on screen with its surroundings,
 * like the account menu), the selection is a soft accent box that slides from row to row, and the row
 * under the pointer or the keyboard is highlighted. A `listbox` with
 * `aria-activedescendant`: focus stays on the list while Arrow keys move the
 * highlight (wrapping), Home/End jump, Enter/Space choose, and Escape or Tab
 * dismisses (a list in a portal would otherwise let Tab run past the page).
 *
 * Each option carries an optional icon, a secondary line (`meta`), a badge and
 * an `extra` slot rendered inside the row, for something positioned against
 * it (a hint popover).
 *
 * @module shared/ui
 */
import { motion } from 'motion/react';
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ENTRANCE_GROUP, ENTRANCE_ITEM, SNAPPY_SPRING } from './motion-presets';

export interface OptionListItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** A second, smaller line under the label. */
  meta?: ReactNode;
  badge?: ReactNode;
  /** Rendered inside the row, after the badge; for something positioned against the row. */
  extra?: ReactNode;
  /** `lang` of the row, when the label is in a language of its own. */
  lang?: string;
  'aria-describedby'?: string;
}

export interface OptionListProps<T extends string> {
  options: readonly OptionListItem<T>[];
  value: T;
  onSelect: (value: T) => void;
  /** Escape or Tab. */
  onDismiss: () => void;
  'aria-labelledby'?: string;
  'aria-label'?: string;
  /** Focus the list when it mounts (it lives in a freshly opened popover). */
  autoFocus?: boolean;
  /**
   * Rows come in one after another when the list mounts. Off where the list
   * opens together with other content that does not animate (the account
   * menu), or that section alone appears late.
   */
  entrance?: boolean;
  id?: string;
  className?: string;
  /** Draws a check mark on the chosen row (for a form control, where the accent box alone is easy to miss). */
  showCheck?: boolean;
}

function OptionListInner<T extends string>(
  {
    options,
    value,
    onSelect,
    onDismiss,
    autoFocus = true,
    entrance = true,
    id,
    className,
    showCheck = false,
    ...aria
  }: OptionListProps<T>,
  ref: ForwardedRef<HTMLUListElement>
): ReactElement {
  const fallbackId = useId();
  const listId = id ?? fallbackId;
  const listRef = useRef<HTMLUListElement>(null);
  useImperativeHandle(ref, () => listRef.current as HTMLUListElement);
  // Starts on the chosen option, so `aria-activedescendant` names it on the
  // very first render.
  const [focus, setFocus] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value)
    )
  );

  useEffect(() => {
    if (!autoFocus) return undefined;
    const frame = requestAnimationFrame(() => listRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  const count = options.length;
  const step = (direction: 1 | -1): void =>
    setFocus((index) => (index + direction + count) % count);

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    const keys: Record<string, () => void> = {
      ArrowDown: () => step(1),
      ArrowUp: () => step(-1),
      Home: () => setFocus(0),
      End: () => setFocus(count - 1),
      Enter: () => {
        const option = options[focus];
        if (option) onSelect(option.value);
      },
      ' ': () => {
        const option = options[focus];
        if (option) onSelect(option.value);
      },
      Escape: onDismiss,
      Tab: onDismiss,
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  const active = options[focus];
  return (
    <motion.ul
      ref={listRef}
      id={listId}
      className={['option-list', className].filter(Boolean).join(' ')}
      role="listbox"
      tabIndex={-1}
      aria-activedescendant={active ? `${listId}-${active.value}` : undefined}
      onKeyDown={onKeyDown}
      initial={entrance ? 'hidden' : false}
      animate="show"
      variants={ENTRANCE_GROUP}
      {...aria}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <motion.li
            key={option.value}
            id={`${listId}-${option.value}`}
            role="option"
            lang={option.lang}
            aria-selected={selected}
            aria-describedby={option['aria-describedby']}
            className={['option-list__option', index === focus ? 'is-focus' : '']
              .filter(Boolean)
              .join(' ')}
            variants={ENTRANCE_ITEM}
            onPointerMove={() => setFocus(index)}
            onClick={() => onSelect(option.value)}
          >
            {selected ? (
              <motion.span
                className="option-list__selected"
                layoutId={`${listId}-selected`}
                transition={SNAPPY_SPRING}
              />
            ) : null}
            {option.icon ? <span className="option-list__icon">{option.icon}</span> : null}
            <span className="option-list__name">
              {option.label}
              {option.meta ? <small>{option.meta}</small> : null}
            </span>
            {option.badge ?? null}
            {showCheck && selected ? (
              <svg className="option-list__check" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            ) : null}
            {option.extra ?? null}
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

// Generic + forwardRef: cast back to a generic call signature so callers keep
// value-type inference on `value` / `onSelect` (the SegmentedControl pattern).
export const OptionList = forwardRef(OptionListInner) as <T extends string>(
  props: OptionListProps<T> & { ref?: ForwardedRef<HTMLUListElement> }
) => ReactElement;
