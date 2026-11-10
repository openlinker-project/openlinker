/**
 * RadioCardGroup
 *
 * A single choice shown as cards: a title and a sentence each, an optional
 * preview underneath and an optional extra control (an amount field). Native
 * radios inside a `radiogroup`, so arrow keys and form semantics come free.
 * An option that cannot be chosen stays visible, greyed, with its reason on the
 * card: a missing option reads as a missing feature.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export interface RadioCardOption<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  /** Rendered under the description, e.g. a document preview. */
  preview?: ReactNode;
  /** Rendered last, inside the card, e.g. an amount field. */
  extra?: ReactNode;
  /** Spans both columns (the "as in settings" card). */
  wide?: boolean;
  disabled?: boolean;
  /** Why it is disabled; shown on the card. */
  reason?: ReactNode;
  'data-testid'?: string;
}

export interface RadioCardGroupProps<T extends string> {
  name: string;
  value: T | null;
  onChange: (value: T) => void;
  options: readonly RadioCardOption<T>[];
  'aria-label': string;
  disabled?: boolean;
  className?: string;
}

export function RadioCardGroup<T extends string>({
  name,
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  disabled = false,
  className,
}: RadioCardGroupProps<T>): ReactElement {
  return (
    <div
      className={['radio-card-group', className].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const off = disabled || option.disabled === true;
        return (
          <label
            key={option.value}
            className={['radio-card', option.wide ? 'radio-card--wide' : ''].filter(Boolean).join(' ')}
            data-disabled={off ? 'true' : undefined}
            data-checked={value === option.value ? 'true' : undefined}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={off}
              onChange={() => onChange(option.value)}
              data-testid={option['data-testid']}
            />
            <span className="radio-card__head">
              <span className="radio-card__title">{option.title}</span>
              {option.description === undefined ? null : (
                <span className="radio-card__desc">{option.description}</span>
              )}
              {option.reason === undefined ? null : (
                <span className="radio-card__reason">{option.reason}</span>
              )}
            </span>
            {option.preview}
            {option.extra}
          </label>
        );
      })}
    </div>
  );
}
