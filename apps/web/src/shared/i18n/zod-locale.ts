/**
 * Zod default messages
 *
 * Switches Zod's built-in validation messages to the active language. Copy a
 * feature writes itself still comes from its copy file; this covers the
 * defaults a schema leaves unset.
 *
 * @module shared/i18n
 */
import { z } from 'zod';
import type { SupportedLocale } from './i18n.types';

let applied: SupportedLocale | null = null;

export function applyZodLocale(locale: SupportedLocale): void {
  if (applied === locale) return;
  z.config(locale === 'pl' ? z.locales.pl() : z.locales.en());
  applied = locale;
}
