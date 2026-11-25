/**
 * Legacy list column choice (#4241)
 *
 * Before saved views the Orders list remembered the viewer's showing columns in
 * `localStorage` under one key. A view's draft columns replace it, so the key is
 * read once, offered to the draft and removed: one source of truth, and nobody
 * loses an arrangement they had set up.
 *
 * @module apps/web/src/features/orders/lib
 */

/** Per-viewer only: the CURRENTLY showing column arrangement, not a preset reference. */
export const LEGACY_VISIBLE_COLUMNS_STORAGE_KEY = 'ol.orders-list.visible-columns.v1';

/** The remembered column ids, or `null` when there are none or the value is unusable. */
export function readLegacyVisibleColumns(): string[] | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((value): value is string => typeof value === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function clearLegacyVisibleColumns(): void {
  try {
    window.localStorage.removeItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY);
  } catch {
    // Blocked storage means there was nothing to carry over in the first place.
  }
}

/** True when the key exists at all, even holding something unusable, so it can still be cleaned up. */
export function hasLegacyVisibleColumnsKey(): boolean {
  try {
    return window.localStorage.getItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
