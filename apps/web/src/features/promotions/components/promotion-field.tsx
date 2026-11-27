/**
 * PromotionField (#3935)
 *
 * A labelled field of the promotion form: the label row (with an optional help
 * `?` and required mark), the control, a description and an inline error that
 * appears when the field is invalid. The error is drawn only on request, so a
 * form does not shout before the operator has had a chance to fill it in.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement, ReactNode } from 'react';

export interface PromotionFieldProps {
  label: ReactNode;
  htmlFor?: string;
  /** A `HelpHint` beside the label. */
  hint?: ReactNode;
  required?: boolean;
  description?: ReactNode;
  /** Draw the description between the label and the control instead of under it. */
  descriptionFirst?: boolean;
  error?: string;
  invalid?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}

export function PromotionField({
  label,
  htmlFor,
  hint,
  required = false,
  description,
  descriptionFirst = false,
  error,
  invalid = false,
  children,
  className,
  id,
}: PromotionFieldProps): ReactElement {
  return (
    <div className={['form-field', invalid ? 'is-invalid' : '', className].filter(Boolean).join(' ')} id={id}>
      <span className="pm-lbl__row">
        {htmlFor !== undefined ? (
          <label className="form-field__label" htmlFor={htmlFor}>
            {label}
            {required ? (
              <span className="pm-req" aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
        ) : (
          <span className="form-field__label">{label}</span>
        )}
        {hint}
      </span>
      {descriptionFirst && description !== undefined ? <p className="form-field__description">{description}</p> : null}
      {children}
      {!descriptionFirst && description !== undefined ? <p className="form-field__description">{description}</p> : null}
      {error !== undefined ? <p className="pm-err">{error}</p> : null}
    </div>
  );
}
