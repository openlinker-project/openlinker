import type { ReactElement } from 'react';
import { Alert } from './alert';
import { useCopy } from '../i18n/use-copy';
import { uiCopy } from './ui.copy';

interface FormErrorSummaryProps {
  errors: string[];
  title?: string;
}

export function FormErrorSummary({
  errors,
  title,
}: FormErrorSummaryProps): ReactElement | null {
  const copy = useCopy(uiCopy).formErrorSummary;
  if (errors.length === 0) {
    return null;
  }

  return (
    <Alert tone="error" title={title ?? copy.title}>
      <ul className="form-error-summary__list">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </Alert>
  );
}
