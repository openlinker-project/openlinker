/**
 * Filter primitives — default copy (#3507)
 *
 * The defaults the shared filter primitives fall back to when a caller passes
 * no label of its own. Every one is overridable per call site, so a page that
 * filters something other than orders never inherits order-specific words.
 *
 * @module shared/ui
 */
export const FILTER_COPY = {
  toggleLabel: 'Filters',
  /** Screen-reader suffix after the active-filter count badge. */
  activeCountSuffix: (count: number): string => (count === 1 ? '1 active' : `${count} active`),
  clearAll: 'Clear all',
  activeFiltersLabel: 'Active filters',
  removeChip: (label: string, value: string): string => `Remove filter ${label}: ${value}`,
  panelLabel: 'Filters',
  panelHint: 'Filters apply as you change them and stay in the address bar.',
  hidePanel: 'Hide filters',
  sheetClose: 'Close filters',
  sectionNone: 'Any',
} as const;
