/**
 * MappingPanel
 *
 * Generic panel for displaying and editing a list of source→target mappings.
 * Used for status, carrier, and payment mapping panels on the connection
 * mappings page.
 *
 * @module apps/web/src/features/mappings/components
 */

import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
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

function labelFor(options: MappingOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
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

  // Track dirty state by comparing local rows to saved rows
  const isDirty =
    localRows.length !== savedRows.length ||
    localRows.some(
      (row, i) =>
        row.sourceValue !== savedRows[i]?.sourceValue ||
        row.targetValue !== savedRows[i]?.targetValue,
    );

  // Sync local rows when saved rows update (after a successful save)
  const [prevSaved, setPrevSaved] = useState(savedRows);
  if (prevSaved !== savedRows) {
    setPrevSaved(savedRows);
    setLocalRows(savedRows);
  }

  function handleAddRow(): void {
    if (!pendingSource || !pendingTarget) return;
    // Prevent duplicate source values
    if (localRows.some((r) => r.sourceValue === pendingSource)) return;
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
        <EmptyState
          liveRegion="off"
          title="No mappings configured"
          message="Orders may sync with incorrect status/carrier/payment. Add a mapping below."
        />
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
            {localRows.map((row) => (
              <tr key={row.sourceValue}>
                <td>{labelFor(sourceOptions, row.sourceValue)}</td>
                <td>{labelFor(targetOptions, row.targetValue)}</td>
                <td>
                  <Button
                    tone="ghost"
                    aria-label={`Remove mapping for ${labelFor(sourceOptions, row.sourceValue)}`}
                    onClick={() => { handleDeleteRow(row.sourceValue); }}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
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
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          aria-label={`Select ${targetLabel}`}
          value={pendingTarget}
          onChange={(e) => { setPendingTarget(e.target.value); }}
        >
          <option value="">— {targetLabel} —</option>
          {targetOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
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

      {saveError && (
        <p className="error-message" role="alert" style={{ marginTop: '0.5rem' }}>
          {saveError.message}
        </p>
      )}

      <div style={{ marginTop: '1rem' }}>
        <Button
          tone="primary"
          disabled={!isDirty || isSaving}
          onClick={handleSave}
        >
          {isSaving ? 'Saving…' : 'Save mappings'}
        </Button>
      </div>
    </div>
  );
}
