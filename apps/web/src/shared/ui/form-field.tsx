import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FieldError } from './field-error';

interface ControlProps {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  className?: string;
  id?: string;
}

interface FormFieldProps {
  children: ReactElement<ControlProps>;
  description?: ReactNode;
  error?: string;
  label: ReactNode;
  name: string;
}

export function FormField({ children, description, error, label, name }: FormFieldProps): ReactElement {
  const reactChild = Children.only(children);
  const generatedId = useId();
  const inputId = reactChild.props.id ?? `${name}-${generatedId}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [reactChild.props['aria-describedby'], descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const ariaInvalid = Boolean(error) || Boolean(reactChild.props['aria-invalid']);

  if (!isValidElement<ControlProps>(reactChild)) {
    throw new Error('FormField expects a single valid form control element.');
  }

  return (
    <div className="form-field">
      <label htmlFor={inputId} className="form-field__label">
        {label}
      </label>
      {cloneElement(reactChild, {
        id: inputId,
        'aria-describedby': describedBy,
        'aria-invalid': ariaInvalid,
      })}
      {description ? (
        <p id={descriptionId} className="form-field__description">
          {description}
        </p>
      ) : null}
      <FieldError id={errorId ?? `${inputId}-error`} message={error} />
    </div>
  );
}
