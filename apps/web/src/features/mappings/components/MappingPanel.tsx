/**
 * MappingPanel
 *
 * Generic panel for displaying and editing a list of source→target mappings.
 * Used for status, carrier, and payment mapping panels on the connection
 * mappings page.
 *
 * @module apps/web/src/features/mappings/components
 */

import { useState, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../../shared/ui/button';
import { Combobox, type ComboboxOption, type ComboboxValue } from '../../../shared/ui/combobox';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import type { MappingOption } from '../api/mappings.types';

export interface MappingRow {
  sourceValue: string;
  targetValue: string;
}

interface MappingPanelProps {
  title: string;
  description: string;
  sourceLabel: string;
  targetLabel: string;
  sourceOptions: MappingOption[];
  targetOptions: MappingOption[];
  /** Current saved state from the server. */
  savedRows: MappingRow[];
  /** Called with the full replacement list when the user saves. */
  onSave: (rows: MappingRow[]) => void;
  isSaving: boolean;
  saveError: Error | null;
  optionsLoading: boolean;
  optionsError: Error | null;
  /**
   * Failure loading this tab's saved-mapping data (#1784 follow-up I2). Rendered
   * as an inline panel error with a retry so one tab's data failure never tears
   * down the pairing strip or the sibling tabs. Distinct from `optionsError`,
   * which is the dropdown-option-list failure.
   */
  dataError?: Error | null;
  /** Retry the saved-mapping data load (paired with `dataError`). */
  onRetryData?: () => void;
  /**
   * Reports the panel's dirty (unsaved-edits) state up so the page can guard a
   * tab switch that would discard staged rows (#1784 follow-up I3).
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Precise per-tab empty-state copy (#1784 follow-up S15). Falls back to a
   * generic message so a caller that omits it still renders sensibly.
   */
  emptyStateMessage?: string;
  /**
   * Suffix appended to `kind === 'dynamic'` options to explain the runtime
   * behaviour (#517). Platform-neutral (#1784): the caller passes the resolved
   * source label, e.g. ` - exact Allegro cost`. Defaults to a generic cue so
   * the dynamic option is still distinguishable if a caller omits it.
   */
  dynamicOptionSuffix?: string;
}

const DEFAULT_DYNAMIC_OPTION_SUFFIX = ' - dynamic';
const DEFAULT_EMPTY_STATE_MESSAGE =
  'No mappings configured yet. Orders may sync with default values. Add one below.';

/**
 * Truncates a long stable id (Allegro UUIDs are 36 chars) to 8 + "…" so it
 * fits inline next to the human label without dominating the row. Short
 * values (like PrestaShop carrier ids `5`, `12`) render verbatim — the
 * length guard short-circuits anything ≤ 9 chars (#474).
 */
function shortValue(value: string): string {
  return value.length <= 9 ? value : `${value.slice(0, 8)}…`;
}

/**
 * Renders a `MappingOption` with the human label as the primary text and a
 * faded mono id-hint when the value differs from the label (#474). When
 * `value === label` (degraded data - adapter fell back to using the id as
 * the name), render a single label and skip the redundant hint.
 *
 * Dynamic-kind options (#517) carry a muted `suffix` explaining the runtime
 * behaviour. The suffix is resolved by the caller (platform-neutral, #1784)
 * and lives outside the mono id-hint span so it stays in the body sans, not
 * the monospace id treatment.
 */
function renderOptionLabel(option: MappingOption, suffix: string): ReactNode {
  const dynamicSuffix =
    option.kind === 'dynamic' ? (
      <span className="mapping-option__dynamic-suffix">{suffix}</span>
    ) : null;

  if (option.label === option.value) {
    return (
      <>
        {option.label}
        {dynamicSuffix}
      </>
    );
  }
  return (
    <>
      {option.label}{' '}
      <span className="mapping-id-hint mono-text">{shortValue(option.value)}</span>
      {dynamicSuffix}
    </>
  );
}

/**
 * Maps a `MappingOption[]` into the searchable-combobox option shape (#1784
 * follow-up I8). The raw id is kept OUT of the visible label — it lives in the
 * combobox `hint` (rendered mono-muted) so 50+ Allegro delivery methods stay
 * scannable by name. Sorted by label for the same reason. The dynamic-kind
 * runtime cue is appended to the label so it survives free-text search.
 */
function toComboOptions(options: MappingOption[], suffix: string): ComboboxOption[] {
  return options
    .map((o) => ({
      id: o.value,
      label: o.kind === 'dynamic' ? `${o.label}${suffix}` : o.label,
      hint: o.value === o.label ? undefined : shortValue(o.value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Single-select combobox value → the underlying option id (or ''). */
function comboSelectedId(value: ComboboxValue | null): string {
  return value?.kind === 'dictionary' ? (value.ids[0] ?? '') : '';
}

export function MappingPanel({
  title,
  description,
  sourceLabel,
  targetLabel,
  sourceOptions,
  targetOptions,
  savedRows,
  onSave,
  isSaving,
  saveError,
  optionsLoading,
  optionsError,
  dataError = null,
  onRetryData,
  onDirtyChange,
  emptyStateMessage = DEFAULT_EMPTY_STATE_MESSAGE,
  dynamicOptionSuffix = DEFAULT_DYNAMIC_OPTION_SUFFIX,
}: MappingPanelProps): ReactElement {
  const [localRows, setLocalRows] = useState<MappingRow[]>(savedRows);
  const [pendingSource, setPendingSource] = useState('');
  const [pendingTarget, setPendingTarget] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Track dirty state by comparing local rows to saved rows
  const isDirty =
    localRows.length !== savedRows.length ||
    localRows.some(
      (row, i) =>
        row.sourceValue !== savedRows[i]?.sourceValue ||
        row.targetValue !== savedRows[i]?.targetValue,
    );

  // Sync local rows when the SAVED CONTENT changes (after a successful save /
  // refetch) - keyed on a content signature, not the array identity. The page
  // rebuilds `savedRows` via `.map()` on every render, so keying on identity
  // would wipe staged edits on any unrelated parent re-render - e.g. the
  // page-level dirty-guard state update this panel itself triggers via
  // `onDirtyChange` (#1784 follow-up I3).
  const savedSignature = savedRows
    .map((r) => `${r.sourceValue}\u0000${r.targetValue}`)
    .join('');
  // Resync only when the saved CONTENT changes; `savedRows` identity is
  // intentionally unstable per parent render, so it is not a dependency here.
  useEffect(() => {
    setLocalRows(savedRows);
  }, [savedSignature]);

  // Surface the dirty signal up for the page-level discard guard (#1784 I3).
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  // On unmount (e.g. tab switch), clear this tab's dirty flag.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function handleAddRow(): void {
    if (!pendingSource || !pendingTarget) return;
    if (localRows.some((r) => r.sourceValue === pendingSource)) {
      setAddError('A mapping for this source value already exists.');
      return;
    }
    setAddError(null);
    setLocalRows((prev) => [...prev, { sourceValue: pendingSource, targetValue: pendingTarget }]);
    setPendingSource('');
    setPendingTarget('');
  }

  function handleDeleteRow(sourceValue: string): void {
    setLocalRows((prev) => prev.filter((r) => r.sourceValue !== sourceValue));
  }

  function handleSave(): void {
    onSave(localRows);
  }

  // O(1) row → option lookups instead of a linear `.find` per cell per render
  // (#1784 follow-up S16).
  const sourceOptionByValue = useMemo(() => {
    const map = new Map<string, MappingOption>();
    for (const o of sourceOptions) map.set(o.value, o);
    return map;
  }, [sourceOptions]);
  const targetOptionByValue = useMemo(() => {
    const map = new Map<string, MappingOption>();
    for (const o of targetOptions) map.set(o.value, o);
    return map;
  }, [targetOptions]);

  // Source options not already mapped. Memoized so the O(rows x options)
  // filter doesn't re-run on unrelated re-renders (#1784 follow-up). Declared
  // before the early returns so the hook order stays stable across renders.
  const mappedSourceValues = useMemo(
    () => new Set(localRows.map((r) => r.sourceValue)),
    [localRows],
  );
  const availableSourceOptions = useMemo(
    () => sourceOptions.filter((o) => !mappedSourceValues.has(o.value)),
    [sourceOptions, mappedSourceValues],
  );
  const sourceComboOptions = useMemo(
    () => toComboOptions(availableSourceOptions, dynamicOptionSuffix),
    [availableSourceOptions, dynamicOptionSuffix],
  );
  const targetComboOptions = useMemo(
    () => toComboOptions(targetOptions, dynamicOptionSuffix),
    [targetOptions, dynamicOptionSuffix],
  );

  if (dataError) {
    return (
      <ErrorState
        title="Unable to load mappings"
        message={dataError.message}
        action={
          onRetryData ? (
            <Button tone="secondary" onClick={onRetryData}>
              Retry
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (optionsLoading) {
    return <LoadingState liveRegion="off" title={`Loading ${title.toLowerCase()} options`} message="Fetching available values…" />;
  }

  if (optionsError) {
    return <ErrorState title="Unable to load options" message={optionsError.message} />;
  }

  const noSourcesLeft = availableSourceOptions.length === 0;

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h3 className="section-title">{title}</h3>
        </div>
        {isDirty && (
          <span className="status-badge status-badge--warning" aria-live="polite">
            Unsaved changes
          </span>
        )}
      </div>

      <p className="muted-text" style={{ marginBottom: '1rem' }}>{description}</p>

      {localRows.length === 0 ? (
        <p className="muted-text" role="status" aria-live="polite">
          {emptyStateMessage}
        </p>
      ) : (
        <table className="data-table data-table--stackable" aria-label={`${title} mappings`}>
          <thead>
            <tr>
              <th>{sourceLabel}</th>
              <th>{targetLabel}</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {localRows.map((row) => {
              const sourceOption = sourceOptionByValue.get(row.sourceValue) ?? null;
              const targetOption = targetOptionByValue.get(row.targetValue) ?? null;
              return (
                <tr key={row.sourceValue}>
                  <td data-label={sourceLabel}>
                    {sourceOption ? (
                      renderOptionLabel(sourceOption, dynamicOptionSuffix)
                    ) : (
                      <span className="mono-text">{row.sourceValue}</span>
                    )}
                  </td>
                  <td data-label={targetLabel}>
                    {targetOption ? (
                      renderOptionLabel(targetOption, dynamicOptionSuffix)
                    ) : (
                      <span className="mono-text">{row.targetValue}</span>
                    )}
                  </td>
                  <td className="data-table__cell--actions">
                    <Button
                      tone="ghost"
                      aria-label={`Remove mapping for ${sourceOption?.label ?? 'orphaned source'}`}
                      onClick={() => { handleDeleteRow(row.sourceValue); }}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Add row form — searchable comboboxes (#1784 I8) so 50+ options stay
          scannable by label; the raw id lives in the option hint, not the text. */}
      <div className="toolbar" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="mapping-panel__add-field">
          <Combobox
            ariaLabel={`Select ${sourceLabel}`}
            options={sourceComboOptions}
            value={pendingSource ? { kind: 'dictionary', ids: [pendingSource] } : null}
            onChange={(next) => { setPendingSource(comboSelectedId(next)); }}
            placeholder={`Select ${sourceLabel}`}
            disabled={noSourcesLeft}
          />
          {noSourcesLeft && (
            <p className="muted-text mapping-panel__add-hint" role="status">
              All source values mapped.
            </p>
          )}
        </div>

        <Combobox
          ariaLabel={`Select ${targetLabel}`}
          options={targetComboOptions}
          value={pendingTarget ? { kind: 'dictionary', ids: [pendingTarget] } : null}
          onChange={(next) => { setPendingTarget(comboSelectedId(next)); }}
          placeholder={`Select ${targetLabel}`}
        />

        <Button
          tone="secondary"
          disabled={!pendingSource || !pendingTarget}
          onClick={handleAddRow}
        >
          Add
        </Button>
      </div>

      {addError && (
        <p className="error-message" role="alert" style={{ marginTop: '0.25rem' }}>
          {addError}
        </p>
      )}

      {saveError && (
        <p className="error-message" role="alert" style={{ marginTop: '0.5rem' }}>
          {saveError.message}
        </p>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <Button
          tone="primary"
          disabled={!isDirty || isSaving}
          onClick={handleSave}
        >
          {isSaving ? 'Saving…' : 'Save mappings'}
        </Button>
        {saveError && (
          <Button tone="secondary" disabled={isSaving} onClick={handleSave}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
