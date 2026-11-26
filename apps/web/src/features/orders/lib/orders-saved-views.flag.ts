/**
 * Orders saved-views flag (#4241)
 *
 * The Orders list is the biggest page in the app and the last one moved onto
 * saved views, so the old column-preset path stays one switch away. Off renders
 * the list exactly as it was before views: the health tabs, the column control
 * with its presets and no `view` param.
 *
 * On by default. Build-time like every `VITE_*` input, read on every call rather
 * than at module load so a test can stub the env. Only the literal `'false'`
 * turns it off, so a typo keeps the new list rather than silently reverting it.
 *
 * @module apps/web/src/features/orders/lib
 */
export function resolveOrdersSavedViewsEnabled(raw: string | undefined): boolean {
  return raw !== 'false';
}

export function isOrdersSavedViewsEnabled(): boolean {
  return resolveOrdersSavedViewsEnabled(
    (import.meta.env as Record<string, string | undefined>).VITE_OL_ORDERS_SAVED_VIEWS_ENABLED,
  );
}
