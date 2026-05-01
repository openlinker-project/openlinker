/**
 * MappingPanel
 *
 * Generic panel for displaying and editing a list of source→target mappings.
 * Used for status, carrier, and payment mapping panels on the connection
 * mappings page.
 *
 * @module apps/web/src/features/mappings/components
 */

import { useState, useEffect, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../../shared/ui/button';
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
}

/**
 * Truncates a long stable id (Allegro UUIDs are 36 chars) to 8 + "…" so it
 * fits inline next to the human label without dominating the row. Short
 * values (like PrestaShop carrier ids `5`, `12`) render verbatim — the
 * length guard short-circuits anything ≤ 9 chars (#474).
 */
function shortValue(value: string): string {
  return value.length <= 9 ? value : `${value.slice(0, 8)}…`;
}

function optionByValue(options: MappingOption[], value: string): MappingOption | null {
  return options.find((o) => o.value === value) ?? null;
}

/**
 * Renders a `MappingOption` with the human label as the primary text and a
 * faded mono id-hint when the value differs from the label (#474). When
 * `value === label` (degraded data — adapter fell back to using the id as
 * the name), render a single label and skip the redundant hint.
 */
function renderOptionLabel(option: MappingOption): ReactNode {
  if (option.label === option.value) {
    return option.label;
  }
  return (
    <>
      {option.label}{' '}
      <span className="mapping-id-hint mono-text">{shortValue(option.value)}</span>
    </>
  );
}

/**
 * Plain-text variant for `<option>` elements — native `<select>` strips
 * styled children, so the id chip is approximated as parenthesised text.
 */
function optionPlainText(option: MappingOption): string {
  return option.label === option.value
    ? option.label
    : `${option.label} (${shortValue(option.value)})`;
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

  // Sync local rows when saved rows update (after a successful save)
  useEffect(() => {
    setLocalRows(savedRows);
  }, [savedRows]);

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

  if (optionsLoading) {
    return <LoadingState liveRegion="off" title={`Loading ${title.toLowerCase()} options`} message="Fetching available values…" />;
  }

  if (optionsError) {
    return <ErrorState title="Unable to load options" message={optionsError.message} />;
  }

  // Source options not already mapped
  const availableSourceOptions = sourceOptions.filter(
    (o) => !localRows.some((r) => r.sourceValue === o.value),
  );

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
          No mappings configured yet. Orders may sync with default values. Add one below.
        </p>
      ) : (
        <table className="data-table" aria-label={`${title} mappings`}>
          <thead>
            <tr>
              <th>{sourceLabel}</th>
              <th>{targetLabel}</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {localRows.map((row) => {
              const sourceOption = optionByValue(sourceOptions, row.sourceValue);
              const targetOption = optionByValue(targetOptions, row.targetValue);
              return (
                <tr key={row.sourceValue}>
                  <td>
                    {sourceOption ? (
                      renderOptionLabel(sourceOption)
                    ) : (
                      <span className="mono-text">{row.sourceValue}</span>
                    )}
                  </td>
                  <td>
                    {targetOption ? (
                      renderOptionLabel(targetOption)
                    ) : (
                      <span className="mono-text">{row.targetValue}</span>
                    )}
                  </td>
                  <td>
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

      {/* Add row form */}
      <div className="toolbar" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <select
          aria-label={`Select ${sourceLabel}`}
          value={pendingSource}
          onChange={(e) => { setPendingSource(e.target.value); }}
          disabled={availableSourceOptions.length === 0}
        >
          <option value="">— {sourceLabel} —</option>
          {availableSourceOptions.map((o) => (
            <option key={o.value} value={o.value}>{optionPlainText(o)}</option>
          ))}
        </select>

        <select
          aria-label={`Select ${targetLabel}`}
          value={pendingTarget}
          onChange={(e) => { setPendingTarget(e.target.value); }}
        >
          <option value="">— {targetLabel} —</option>
          {targetOptions.map((o) => (
            <option key={o.value} value={o.value}>{optionPlainText(o)}</option>
          ))}
        </select>

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
