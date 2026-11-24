import type { ReactElement } from 'react';
import { useMessages } from '../i18n/use-messages';

interface EmptyValueProps {
  label?: string;
}

export function EmptyValue({ label }: EmptyValueProps): ReactElement {
  const copy = useMessages('ui').emptyValue;
  return (
    <span className="text-muted" aria-label={label ?? copy.label}>
      —
    </span>
  );
}
