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
      days: { one: '{n}d', other: '{n}d' },
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
      minutesAgo: '{n}m ago',
      hoursAgo: '{n}h ago',
      daysAgo: { one: '{n}d ago', other: '{n}d ago' },
    },
  },
  pl: {
    shipBy: {
      left: '{duration} do terminu',
      overdue: 'Po terminie {duration}',
      dueNow: 'termin teraz',
    },
    compactDuration: {
      days: { one: '{n} dzień', few: '{n} dni', many: '{n} dni', other: '{n} dnia' },
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
      minutesAgo: '{n} min temu',
      hoursAgo: '{n} godz. temu',
      daysAgo: {
        one: '{n} dzień temu',
        few: '{n} dni temu',
        many: '{n} dni temu',
        other: '{n} dnia temu',
      },
    },
  },
});
