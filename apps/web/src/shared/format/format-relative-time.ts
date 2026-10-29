/**
 * Relative time formatting
 *
 * "5m ago" style timestamps through `Intl.RelativeTimeFormat`, so Polish
 * gets its own words and plural forms ("5 min temu", "3 dni temu"). English
 * keeps the compact narrow style; Polish uses the short style, whose narrow
 * forms ("2 g. temu") read as typos.
 *
 * @module shared/format
 */
import { getLocale } from '../i18n/active-locale';
import { resolveCopy } from '../i18n/define-copy';
import type { SupportedLocale } from '../i18n/i18n.types';
import { formatCopy } from './format.copy';
import { formattingLocale } from './format-locale';

export function formatRelativeTime(
  iso: string,
  locale?: SupportedLocale,
  now: number = Date.now(),
): string {
  const active = locale ?? getLocale();
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return resolveCopy(formatCopy, active).relative.justNow;
  const rtf = new Intl.RelativeTimeFormat(formattingLocale(active), {
    numeric: 'always',
    style: active === 'en' ? 'narrow' : 'short',
  });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.floor(hours / 24), 'day');
}
