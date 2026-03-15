import type { ReactElement } from 'react';

interface FieldErrorProps {
  id: string;
  message?: string;
}

export function FieldError({ id, message }: FieldErrorProps): ReactElement | null {
  if (!message) {
    return null;
  }

  return (
    <p id={id} className="form-field__error" role="alert">
      {message}
    </p>
  );
}
