/**
 * Relative time formatting
 *
 * "5m ago" style timestamps from copy templates, in both languages. Templates
 * rather than `Intl.RelativeTimeFormat`, because the ICU data behind it
 * changes the words between Node and browser versions ("5m ago" vs
 * "5 min. ago"), and an operator should see the same text everywhere.
 *
 * @module shared/format
 */
import { getLocale } from '../i18n/active-locale';
import { resolveCopy } from '../i18n/define-copy';
import { interpolate } from '../i18n/interpolate';
import { formatPlural } from '../i18n/plural';
import type { SupportedLocale } from '../i18n/i18n.types';
import { formatCopy } from './format.copy';

export function formatRelativeTime(
  iso: string,
  now: number = Date.now(),
  locale?: SupportedLocale,
): string {
  const active = locale ?? getLocale();
  const copy = resolveCopy(formatCopy, active).relative;
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return copy.justNow;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return interpolate(copy.minutesAgo, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return interpolate(copy.hoursAgo, { n: hours });
  return formatPlural(Math.floor(hours / 24), copy.daysAgo, active);
}
