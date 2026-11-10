/**
 * RadioCardGroup (#3935)
 *
 * A group of choices drawn as cards: each card holds a title, a one-line
 * description and whatever illustrates the choice (a mini document, a diagram),
 * and the whole card is the radio. The selected card is tinted and an optional
 * panel opens inside it for the choice's own input. Built on real radio inputs,
 * so arrow keys, `name` grouping and form semantics are the browser's.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export interface RadioCardOption<V extends string> {
  value: V;
  title: ReactNode;
  description?: ReactNode;
  /** The illustration under the description. */
  preview?: ReactNode;
  /** Opens inside the card while it is selected. */
  panel?: ReactNode;
  /** Spans both columns. */
  wide?: boolean;
  disabled?: boolean;
  /** Why it is disabled; shown in place of the description. */
  disabledReason?: ReactNode;
  /** A link or action at the foot of the card. */
  footer?: ReactNode;
  'data-testid'?: string;
}

export interface RadioCardGroupProps<V extends string> {
  name: string;
  value: V | null;
  onChange: (value: V) => void;
  options: readonly RadioCardOption<V>[];
  'aria-label': string;
  disabled?: boolean;
  className?: string;
}

export function RadioCardGroup<V extends string>({
  name,
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  disabled = false,
  className,
}: RadioCardGroupProps<V>): ReactElement {
  return (
    <div
      className={['pm-docs', className].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const off = disabled || option.disabled === true;
        return (
          <label
            key={option.value}
            className={[
              'pm-doccard',
              option.wide ? 'pm-doccard--wide' : '',
              selected ? 'is-on' : '',
              off ? 'is-disabled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              disabled={off}
              data-testid={option['data-testid']}
              onChange={() => {
                onChange(option.value);
              }}
            />
            <span className="pm-doccard__h">
              <span className="pm-doccard__t">{option.title}</span>
              <span className="pm-doccard__d">
                {option.disabled === true && option.disabledReason ? option.disabledReason : option.description}
              </span>
            </span>
            {option.preview}
            {option.panel !== undefined ? (
              <span className={['pm-disc__body', 'pm-doccard__amt', selected ? 'is-open' : ''].filter(Boolean).join(' ')}>
                <span>
                  <span className="pm-disc__inner">{option.panel}</span>
                </span>
              </span>
            ) : null}
            {option.footer}
          </label>
        );
      })}
    </div>
  );
}
