/**
 * shared/ui — public catalog (#611)
 *
 * Curated barrel of the primitives plugin authors and host code can
 * compose against. The catalog is the contract: anything not re-exported
 * here is internal — moving / renaming / deleting internal modules
 * shouldn't break consumers.
 *
 * Scope is deliberately narrow in v1 (~25 primitives covering the cockpit
 * vocabulary documented in `docs/frontend-ui-style-guide.md`). Adding a
 * primitive is a one-line edit — keep the list scannable and add only
 * what real consumers need.
 *
 * Components that wrap headless libraries (Radix, TanStack) live here on
 * the same footing as native-HTML wrappers — the wrapper is the public
 * surface, the underlying library is an implementation detail.
 *
 * @module shared/ui
 */

// ── Feedback / status ──────────────────────────────────────────────
export { Alert } from './alert';
export type { AlertTone } from './alert';
export { StatusBadge } from './status-badge';
export type { StatusBadgeTone } from './status-badge';
export { EmptyState, ErrorState, LoadingState } from './feedback-state';
export { StructuredErrorList } from './structured-error-list';

// ── Controls ───────────────────────────────────────────────────────
export { Button } from './button';
export type { ButtonProps, ButtonTone } from './button';
export { Input } from './input';
export { Textarea } from './textarea';
export { Select } from './select';
export { Combobox } from './combobox';
export type { ComboboxOption, ComboboxValue } from './combobox';
export { SegmentedControl } from './segmented-control';
export type { SegmentedControlOption, SegmentedControlProps } from './segmented-control';

// ── Form composition ───────────────────────────────────────────────
export { FormField } from './form-field';
export { FieldError } from './field-error';
export { FormErrorSummary } from './form-error-summary';

// ── Layout / navigation ────────────────────────────────────────────
export { PageLayout } from './page-layout';
export { BackLink } from './back-link';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';
export { SetupStepper } from './setup-stepper';

// ── Overlays / popovers (Radix-wrapped) ────────────────────────────
export { CommandPalette, CommandPaletteTrigger } from './command-palette';
export type { CommandPaletteProps, PaletteItem, PaletteGroup } from './command-palette';
export { Dialog } from './dialog';
export { ConfirmDialog } from './confirm-dialog';
export { DropdownMenu } from './dropdown-menu';
export { Popover } from './popover';
export { Tooltip } from './tooltip';

// ── Data surfaces ──────────────────────────────────────────────────
export { DataTable } from './data-table';
export type { DataTableColumn, DataTableCardView, DataTableHideBreakpoint } from './data-table';
export { KeyValueList } from './key-value-list';
export { RawPayloadPanel } from './raw-payload-panel';
export { TimeDisplay } from './time-display';
export { MetricCard } from './metric-card';
export { KpiCard } from './kpi-card';

// ── Identity / labels ──────────────────────────────────────────────
export { EntityLabel } from './entity-label';
export { ProductThumbnail } from './product-thumbnail';
export { CopyableId } from './copyable-id';
export { DensityToggle, useDensity } from './density-toggle';
export type { Density } from './density-toggle';

// ── Bulk-selection (#739, #1109) ────────────────────────────────────
export { BulkActionBar } from './bulk-action-bar';
export type { BulkActionBarProps } from './bulk-action-bar';
export { CheckboxCell } from './checkbox-cell';
export type { CheckboxCellProps } from './checkbox-cell';

// ── Disclosure (#1303) ───────────────────────────────────────────────
export { InlineDisclosure } from './inline-disclosure';
export type { InlineDisclosureProps } from './inline-disclosure';
