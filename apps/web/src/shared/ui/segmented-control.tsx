import {
  forwardRef,
  useRef,
  type ComponentPropsWithoutRef,
  type ForwardedRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

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
}

export interface SegmentedControlProps<T extends string>
  extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A single-select segmented toggle (Shopify/Linear-style). Wraps the shared
 * `.segmented-control` CSS so features don't hand-roll one-off inline controls.
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
      default:
        break;
    }
  };

  return (
    <div ref={ref} role="radiogroup" className={classes} {...rest}>
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
