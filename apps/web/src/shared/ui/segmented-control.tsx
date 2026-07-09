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

  const selectAt = (index: number): void => {
    const next = options[index];
    if (next === undefined) return;
    onChange(next.value);
    optionRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const count = options.length;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        selectAt((index + 1) % count);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        selectAt((index - 1 + count) % count);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={ref} role="radiogroup" className={classes} {...rest}>
      {options.map((option, index) => {
        const active = option.value === value;
        const optionClasses = [
          'segmented-control__option',
          active ? 'segmented-control__option--active' : '',
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
            // Roving tabindex: the group is a single tab stop. The checked
            // option is tabbable; when nothing is checked yet the first option
            // takes the stop so the group is still keyboard-reachable.
            tabIndex={active || (!hasActive && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
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
