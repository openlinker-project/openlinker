/**
 * TimeDisplay Component
 *
 * Renders a timestamp as a semantic <time> element using shared date formatters.
 * Wrapping dates in <time> improves accessibility (screen readers) and SEO.
 *
 * @module apps/web/src/shared/ui
 */

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { formatAbsoluteDate, formatDateTime } from '../format/format-date';
import { formatRelativeTime } from '../format/format-relative-time';

interface TimeDisplayProps extends Omit<ComponentPropsWithoutRef<'time'>, 'dateTime' | 'children'> {
  iso: string;
  format?: 'date' | 'datetime' | 'relative';
}

export const TimeDisplay = forwardRef<HTMLTimeElement, TimeDisplayProps>(
  function TimeDisplay({ iso, format = 'datetime', className = '', ...props }, ref) {
    const label =
      format === 'relative' ? formatRelativeTime(iso) :
      format === 'date'     ? formatAbsoluteDate(iso) :
                              formatDateTime(iso);

    return (
      <time ref={ref} {...props} dateTime={iso} className={className}>
        {label}
      </time>
    );
  },
);
