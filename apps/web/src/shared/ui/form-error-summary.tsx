import type { ReactElement } from 'react';
import { Alert } from './alert';

interface FormErrorSummaryProps {
  errors: string[];
  title?: string;
}

export function FormErrorSummary({
  errors,
  title = 'Please correct the highlighted fields.',
}: FormErrorSummaryProps): ReactElement | null {
  if (errors.length === 0) {
    return null;
  }

  return (
    <Alert tone="error" title={title}>
      <ul className="form-error-summary__list">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </Alert>
  );
}
