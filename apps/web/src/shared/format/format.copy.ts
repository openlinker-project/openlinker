/**
 * Shared formatter copy
 *
 * Words the shared formatters put around numbers: deadline countdowns,
 * relative time and compact durations. Units stay short because these
 * strings sit in table cells and badges.
 *
 * @module shared/format
 */
import { defineCopy } from '../i18n/define-copy';

export const formatCopy = defineCopy({
  en: {
    shipBy: {
      left: '{duration} left',
      overdue: 'Overdue {duration}',
      dueNow: 'due now',
    },
    compactDuration: {
      days: '{n}d',
      hours: '{n}h',
      minutes: '{n}m',
    },
    duration: {
      milliseconds: '{n} ms',
      seconds: '{n} s',
      minutesSeconds: '{m}m {s}s',
      hoursMinutes: '{h}h {m}m',
    },
    relative: {
      justNow: 'just now',
    },
  },
  pl: {
    shipBy: {
      left: 'zostało {duration}',
      overdue: 'Po terminie {duration}',
      dueNow: 'termin mija teraz',
    },
    compactDuration: {
      days: '{n} d',
      hours: '{n} godz.',
      minutes: '{n} min',
    },
    duration: {
      milliseconds: '{n} ms',
      seconds: '{n} s',
      minutesSeconds: '{m} min {s} s',
      hoursMinutes: '{h} godz. {m} min',
    },
    relative: {
      justNow: 'przed chwilą',
    },
  },
});
