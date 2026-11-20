import { motion } from 'motion/react';
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ForwardedRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { SEGMENT_THUMB_SPRING } from './motion-presets';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional secondary hint rendered beside the label (decorative — aria-hidden). */
  hint?: ReactNode;
  /**
   * Render the option but refuse selection.
   *
   * Present so a caller whose option cannot currently be submitted can say so
   * in place rather than hiding it — a missing option reads as a missing
   * feature, while a disabled one plus an explanation is a state the operator
   * can act on. Disabled options are skipped by arrow navigation and never take
   * the group's tab stop, per the WAI-ARIA radio-group pattern.
   */
  disabled?: boolean;
  /** Test id placed on the clickable option element itself. */
  'data-testid'?: string;
}

export interface SegmentedControlProps<T extends string>
  extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  options: readonly SegmentedControlOption<T>[];
  /**
   * The selected option, or `null` for "no answer yet".
   *
   * `null` renders the group with NO option checked, which the roving-tabindex
   * logic below already supports (`hasActive`). It exists for a caller whose
   * value has a persisted default still in flight (#2668 review, finding 3/6):
   * pre-selecting one option there asserts an answer the caller does not have,
   * and the operator watches the selection move under them when the real one
   * arrives. Pair it with `aria-busy` and disabled options on the wrapper.
   */
  value: T | null;
  onChange: (value: T) => void;
}

/**
 * A single-select segmented toggle (Shopify/Linear-style). Wraps the shared
 * `.segmented-control` CSS so features don't hand-roll one-off inline controls.
 *
 * The selection is one thumb that glides to the chosen option (a critically damped
 * spring on its position and width, measured from the option, so it never stretches or
 * warps the way a scaled layout animation does). `MotionProvider`'s
 * `reducedMotion="user"` turns it into an instant switch for anyone who asks for less motion.
 *
 * Uses the ARIA radiogroup idiom (`role="radiogroup"` + `role="radio"` /
 * `aria-checked`) rather than toggle buttons, because the control is a
 * single-select "pick one of N" — that communicates the intent precisely to
 * screen readers. Keyboard: a roving tabindex keeps the group a single tab
 * stop and Arrow keys move (and select) between options, per the WAI-ARIA
 * radio-group pattern.
 *
 * The group is unlabelled by default — pass `aria-label`/`aria-labelledby` (and,
 * for form use, `aria-describedby`/`aria-invalid`/`aria-errormessage`) via the
 * spread props so the error/description associate for screen readers.
 */
function SegmentedControlInner<T extends string>(
  { options, value, onChange, className = '', ...rest }: SegmentedControlProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const classes = ['segmented-control', className].filter(Boolean).join(' ');
  const trackRef = useRef<HTMLDivElement | null>(null);
  const setTrackRef = useCallback(
    (node: HTMLDivElement | null): void => {
      trackRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  // Where the thumb belongs: the active option's box inside the track. Measured, not layout-animated,
  // because a scaled layout animation stretches the thumb's corners and shadow while it travels.
  const [thumb, setThumb] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const activeIndex = options.findIndex((option) => option.value === value);
  useLayoutEffect(() => {
    const track = trackRef.current;
    const button = activeIndex >= 0 ? optionRefs.current[activeIndex] : null;
    if (!track || !button) {
      setThumb(null);
      return undefined;
    }
    const measure = (): void => {
      setThumb((previous) => {
        const next = {
          x: button.offsetLeft,
          y: button.offsetTop,
          width: button.offsetWidth,
          height: button.offsetHeight,
        };
        return previous &&
          previous.x === next.x &&
          previous.y === next.y &&
          previous.width === next.width &&
          previous.height === next.height
          ? previous
          : next;
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    observer.observe(button);
    return () => observer.disconnect();
  }, [activeIndex, options]);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hasActive = options.some((option) => option.value === value);
  // The tab stop when nothing is checked yet. Never a disabled option: parking
  // the group's only tab stop on something unselectable would make the whole
  // control keyboard-unreachable.
  const firstEnabled = options.findIndex((option) => option.disabled !== true);

  const selectAt = (index: number): void => {
    const next = options[index];
    if (next === undefined || next.disabled === true) return;
    onChange(next.value);
    optionRefs.current[index]?.focus();
  };

  /**
   * The next selectable option in `step` direction, skipping disabled ones.
   *
   * Bounded by the option count so an all-disabled group terminates rather than
   * looping forever.
   */
  const nextEnabledFrom = (index: number, step: number): number | null => {
    const count = options.length;
    for (let hop = 1; hop <= count; hop += 1) {
      const candidate = (index + step * hop + count * count) % count;
      if (options[candidate]?.disabled !== true) return candidate;
    }
    return null;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        event.preventDefault();
        const next = nextEnabledFrom(index, 1);
        if (next !== null) selectAt(next);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        event.preventDefault();
        const previous = nextEnabledFrom(index, -1);
        if (previous !== null) selectAt(previous);
        break;
      }
      case 'Home': {
        event.preventDefault();
        const first = options.findIndex((option) => option.disabled !== true);
        if (first >= 0) selectAt(first);
        break;
      }
      case 'End': {
        event.preventDefault();
        for (let index = options.length - 1; index >= 0; index -= 1) {
          if (options[index]?.disabled !== true) {
            selectAt(index);
            break;
          }
        }
        break;
      }
      default:
        break;
    }
  };

  return (
    <div ref={setTrackRef} role="radiogroup" className={classes} {...rest}>
      {thumb ? (
        <motion.span
          className="segmented-control__thumb"
          aria-hidden="true"
          // First paint places it without travelling from the origin.
          initial={false}
          animate={{ x: thumb.x, y: thumb.y, width: thumb.width, height: thumb.height }}
          transition={SEGMENT_THUMB_SPRING}
        />
      ) : null}
      {options.map((option, index) => {
        const active = option.value === value;
        const isDisabled = option.disabled === true;
        const optionClasses = [
          'segmented-control__option',
          active ? 'segmented-control__option--active' : '',
          isDisabled ? 'segmented-control__option--disabled' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={option.value}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            data-testid={option['data-testid']}
            className={optionClasses}
            aria-checked={active}
            disabled={isDisabled}
            // Roving tabindex: the group is a single tab stop. The checked
            // option is tabbable; when nothing is checked yet the first option
            // takes the stop so the group is still keyboard-reachable.
            tabIndex={active || (!hasActive && index === firstEnabled) ? 0 : -1}
            onClick={() => {
              if (isDisabled) return;
              onChange(option.value);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="segmented-control__label">{option.label}</span>
            {option.hint !== undefined && (
              <span className="segmented-control__hint" aria-hidden="true">
                {option.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Generic + forwardRef: cast the wrapped component back to a generic call
// signature so callers keep full value-type inference on `value`/`onChange`.
export const SegmentedControl = forwardRef(SegmentedControlInner) as <T extends string>(
  props: SegmentedControlProps<T> & { ref?: ForwardedRef<HTMLDivElement> },
) => ReactElement;
