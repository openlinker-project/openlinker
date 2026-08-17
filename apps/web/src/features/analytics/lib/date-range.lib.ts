/**
 * Date Range Helpers
 *
 * Pure preset/derive/UTC-widening math for the /analytics date-range
 * toolbar. Mirrors the day-boundary widening pattern in
 * pages/orders/orders-list-page.tsx (createdFrom/createdTo), but the
 * preset-derivation and draft/commit semantics are new for this page —
 * see Decision 1 in docs/plans/implementation-plan-analytics-page-shell.md.
 *
 * @module apps/web/src/features/analytics/lib
 */

export type DateRangePreset = '7d' | '30d' | '90d';
export type DateRangeHighlight = DateRangePreset | 'custom';

export const PRESET_DAYS: Record<DateRangePreset, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function computePresetRange(
  preset: DateRangePreset,
  today: Date,
): { from: string; to: string } {
  const to = new Date(today);
  const from = new Date(today);
  from.setDate(from.getDate() - (PRESET_DAYS[preset] - 1));
  return { from: formatDate(from), to: formatDate(to) };
}

export function derivePreset(from: string, to: string, today: Date): DateRangeHighlight {
  const presets: DateRangePreset[] = ['7d', '30d', '90d'];
  const match = presets.find((preset) => {
    const range = computePresetRange(preset, today);
    return range.from === from && range.to === to;
  });
  return match ?? 'custom';
}
