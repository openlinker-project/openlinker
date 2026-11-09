/**
 * SegmentedSwitch
 *
 * A horizontal pick-one switch of icons (#4029): a raised thumb springs to the
 * chosen option, and pressing an option gives its icon a small twist. The
 * names live in a row under the icons, one under each, so they never crowd the
 * segments; `labels` decides when that row shows:
 *
 * - `always`: a settings menu, where there is room and nothing to discover;
 * - `hover`: only while the switch is pointed at or keyboard-focused, and
 *   always on a touch screen (there is no hover there to reveal it with);
 * - `none`: icons only (every option still has an accessible name).
 *
 * A radio group with a roving tab stop: Arrow keys move and select (wrapping),
 * Home/End jump. Escape and Tab call `onDismiss` when given, for a switch that
 * lives in a popover. `animateIn` brings the options in one after another, the
 * popover family's entrance.
 *
 * Not to be confused with `SegmentedControl`, the text-only control forms use.
 *
 * @module shared/ui
 */
import { AnimatePresence, motion } from 'motion/react';
import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ENTRANCE_GROUP, ENTRANCE_ITEM, SNAPPY_SPRING, THUMB_SPRING } from './motion-presets';

export interface SegmentedSwitchOption<T extends string> {
  value: T;
  /** The visible name and the option's accessible name. */
  label: string;
  icon: ReactNode;
  /** The angle the icon twists to while pressed (degrees). */
  pressTurn?: number;
}

export type SegmentedSwitchLabels = 'always' | 'hover' | 'none';

export interface SegmentedSwitchProps<T extends string> {
  options: readonly SegmentedSwitchOption<T>[];
  value: T;
  onChange: (value: T) => void;
  labels?: SegmentedSwitchLabels;
  /** Options come in one after another (inside a freshly opened popover). */
  animateIn?: boolean;
  /** Focus the chosen option on mount. */
  autoFocus?: boolean;
  /** Escape or Tab: close the popover the switch lives in. */
  onDismiss?: () => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Id of the radio group (for a trigger's `aria-controls`). */
  id?: string;
  className?: string;
}

/** Captured once: a touch screen does not turn into a mouse one mid-session. */
function isTouchScreen(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none)').matches
  );
}

const CAPTION_VARIANTS = {
  hidden: { opacity: 0, y: 3, filter: 'blur(3px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)' },
} as const;

// Caption row (22px) plus the gap above it.
const CAPTION_HEIGHT = 26;

function SegmentedSwitchInner<T extends string>(
  {
    options,
    value,
    onChange,
    labels = 'always',
    animateIn = false,
    autoFocus = false,
    onDismiss,
    id,
    className,
    ...aria
  }: SegmentedSwitchProps<T>,
  ref: ForwardedRef<HTMLDivElement>
): ReactElement {
  const fallbackId = useId();
  const groupId = id ?? fallbackId;
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Stable ref callbacks, one per option. An inline `ref={(el) => ...}` is a
  // fresh function every render; inside a Radix menu (the user menu) that
  // tore the ref down and re-attached it on every render, looping (#461).
  const optionCount = options.length;
  const setOptionRef = useMemo(
    () =>
      Array.from({ length: optionCount }, (_, index) => (el: HTMLButtonElement | null): void => {
        optionRefs.current[index] = el;
      }),
    [optionCount]
  );
  const [pointing, setPointing] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [touch] = useState(isTouchScreen);
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  // Read once on mount, to focus the chosen option.
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    if (!autoFocus) return undefined;
    const frame = requestAnimationFrame(() => optionRefs.current[activeIndexRef.current]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  const revealed =
    labels === 'always' || (labels === 'hover' && (touch || pointing !== null || keyboard));

  function select(index: number): void {
    const count = options.length;
    const next = options[(index + count) % count];
    if (!next) return;
    onChange(next.value);
    optionRefs.current[options.indexOf(next)]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const keys: Record<string, (() => void) | undefined> = {
      ArrowRight: () => select(activeIndex + 1),
      ArrowDown: () => select(activeIndex + 1),
      ArrowLeft: () => select(activeIndex - 1),
      ArrowUp: () => select(activeIndex - 1),
      Home: () => select(0),
      End: () => select(options.length - 1),
      Escape: onDismiss,
      Tab: onDismiss,
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  const names = (
    <motion.div
      className="segmented-switch__names"
      initial={labels === 'hover' ? 'hidden' : false}
      animate="shown"
      exit="hidden"
      variants={{
        shown: { transition: { staggerChildren: 0.035 } },
        hidden: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
      }}
    >
      {options.map((option, index) => (
        <motion.span
          key={option.value}
          className="segmented-switch__name"
          data-state={
            index === pointing ? 'pointed' : option.value === value ? 'active' : undefined
          }
          variants={CAPTION_VARIANTS}
          transition={SNAPPY_SPRING}
        >
          {option.label}
        </motion.span>
      ))}
    </motion.div>
  );

  return (
    <div
      ref={ref}
      className={['segmented-switch', className].filter(Boolean).join(' ')}
      onPointerLeave={() => setPointing(null)}
      onFocus={(event) => setKeyboard(event.target.matches(':focus-visible'))}
      onBlur={() => setKeyboard(false)}
    >
      <motion.div
        id={groupId}
        className="segmented-switch__track"
        role="radiogroup"
        onKeyDown={onKeyDown}
        initial={animateIn ? 'hidden' : false}
        animate="show"
        variants={ENTRANCE_GROUP}
        {...aria}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            // The press animation lives on the button and reaches the icon as
            // the `tap` variant: `whileTap` on the icon itself would make Motion
            // give that span tabIndex=0, a stray tab stop inside the radio.
            <motion.button
              key={option.value}
              ref={setOptionRef[index]}
              variants={ENTRANCE_ITEM}
              whileTap="tap"
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              aria-label={option.label}
              className="segmented-switch__option"
              onPointerEnter={() => setPointing(index)}
              onClick={() => onChange(option.value)}
            >
              {selected ? (
                <motion.span
                  className="segmented-switch__thumb"
                  layoutId={`${groupId}-thumb`}
                  transition={THUMB_SPRING}
                />
              ) : null}
              <motion.span
                className="segmented-switch__icon"
                variants={{
                  hidden: { scale: 1, rotate: 0 },
                  show: { scale: 1, rotate: 0 },
                  tap: { scale: 0.8, rotate: option.pressTurn ?? -20 },
                }}
                transition={SNAPPY_SPRING}
              >
                {option.icon}
              </motion.span>
            </motion.button>
          );
        })}
      </motion.div>
      {labels === 'none' ? null : (
        <div aria-hidden="true">
          {labels === 'always' ? (
            <div className="segmented-switch__caption">{names}</div>
          ) : (
            <AnimatePresence initial={false}>
              {revealed ? (
                <motion.div
                  key="caption"
                  className="segmented-switch__caption"
                  initial={{ height: 0 }}
                  animate={{ height: CAPTION_HEIGHT }}
                  exit={{ height: 0 }}
                  transition={SNAPPY_SPRING}
                >
                  {names}
                </motion.div>
              ) : null}
            </AnimatePresence>
          )}
        </div>
      )}
    </div>
  );
}

// Generic + forwardRef: cast back to a generic call signature so callers keep
// value-type inference on `value` / `onChange` (the SegmentedControl pattern).
export const SegmentedSwitch = forwardRef(SegmentedSwitchInner) as <T extends string>(
  props: SegmentedSwitchProps<T> & { ref?: ForwardedRef<HTMLDivElement> }
) => ReactElement;
