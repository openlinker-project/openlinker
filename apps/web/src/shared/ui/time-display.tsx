/**
 * TimeDisplay Component
 *
 * Renders a timestamp as a semantic <time> element using shared date formatters.
 * Wrapping dates in <time> improves accessibility (screen readers) and SEO.
 *
 * @module apps/web/src/shared/ui
 */

import type { ReactElement } from 'react';
import { formatAbsoluteDate, formatDateTime } from '../format/format-date';
import { formatRelativeTime } from '../format/format-relative-time';

interface TimeDisplayProps {
  iso: string;
  format?: 'date' | 'datetime' | 'relative';
}

export function TimeDisplay({ iso, format = 'datetime' }: TimeDisplayProps): ReactElement {
  const label =
    format === 'relative' ? formatRelativeTime(iso) :
    format === 'date'     ? formatAbsoluteDate(iso) :
                            formatDateTime(iso);

  return <time dateTime={iso}>{label}</time>;
}
