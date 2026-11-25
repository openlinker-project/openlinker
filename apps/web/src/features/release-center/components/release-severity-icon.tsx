/**
 * Severity icons of a message notification. Each severity has its own SHAPE
 * (circle, triangle, octagon, tick in a circle), so the meaning never rests on
 * colour alone; the row also prints the severity as a word.
 *
 * @module features/release-center/components
 */
import type { ReactElement } from 'react';
import type { NotificationSeverity } from '../lib/notification-store';

export function SeverityIcon({ severity }: { severity: NotificationSeverity }): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {severity === 'warning' ? (
        <path d="M8 2.2l6 10.6H2L8 2.2zM8 6.6v3M8 11.6v.1" />
      ) : severity === 'error' ? (
        <path d="M5.2 1.8h5.6l3.4 3.4v5.6l-3.4 3.4H5.2l-3.4-3.4V5.2l3.4-3.4zM8 5v3.6M8 11v.1" />
      ) : severity === 'success' ? (
        <path d="M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM5.2 8.2l2 2 3.6-4" />
      ) : (
        <path d="M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM8 7.2v3.6M8 5v.1" />
      )}
    </svg>
  );
}
