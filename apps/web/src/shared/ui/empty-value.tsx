import type { ReactElement } from 'react';

interface EmptyValueProps {
  label?: string;
}

export function EmptyValue({ label = 'No value' }: EmptyValueProps): ReactElement {
  return (
    <span className="text-muted" aria-label={label}>
      —
    </span>
  );
}
