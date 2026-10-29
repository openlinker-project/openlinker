import type { ReactElement } from 'react';
import { useCopy } from '../i18n/use-copy';
import { uiCopy } from './ui.copy';

interface EmptyValueProps {
  label?: string;
}

export function EmptyValue({ label }: EmptyValueProps): ReactElement {
  const copy = useCopy(uiCopy).emptyValue;
  return (
    <span className="text-muted" aria-label={label ?? copy.label}>
      —
    </span>
  );
}
