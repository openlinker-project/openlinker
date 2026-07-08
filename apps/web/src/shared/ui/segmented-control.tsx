import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ForwardedRef,
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
 * The group is unlabelled by default — pass `aria-label`/`aria-labelledby` (and,
 * for form use, `aria-describedby`/`aria-invalid`/`aria-errormessage`) via the
 * spread props so the error/description associate for screen readers.
 */
function SegmentedControlInner<T extends string>(
  { options, value, onChange, className = '', ...rest }: SegmentedControlProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const classes = ['segmented-control', className].filter(Boolean).join(' ');

  return (
    <div ref={ref} role="group" className={classes} {...rest}>
      {options.map((option) => {
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
            type="button"
            className={optionClasses}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
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
