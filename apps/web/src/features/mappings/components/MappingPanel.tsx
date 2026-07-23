/**
 * MappingPanel
 *
 * Generic panel for displaying and editing a list of source→target mappings.
 * Used for status, carrier, and payment mapping panels on the connection
 * mappings page.
 *
 * @module apps/web/src/features/mappings/components
 */

import { useState, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
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
  /**
   * Deep-link pre-focus (#1794): a source value to pre-select in the add-row
   * form and scroll/highlight, so an operator arriving from the order-detail
   * "Add mapping" fix-it link lands on the exact unmapped method. Ignored when
   * the value is already mapped or absent from the loaded source options.
   */
  focusSourceValue?: string | null;
  /** Human label for `focusSourceValue`, used in the pre-focus hint copy. */
  focusSourceName?: string | null;
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
 * Suffix appended to `kind === 'dynamic'` options to distinguish them from
 * static carriers (#517). Native `<option>` is text-only so the cue lives
 * in the label string itself; the cockpit-style separator is the em-dash
 * established elsewhere in OpenLinker FE copy. Keep this short — it
 * appends to a 32 px-tall native select cell at 13.5 px IBM Plex Sans.
 */
const DYNAMIC_OPTION_SUFFIX = ' — exact Allegro cost';

/**
 * Renders a `MappingOption` with the human label as the primary text and a
 * faded mono id-hint when the value differs from the label (#474). When
 * `value === label` (degraded data — adapter fell back to using the id as
 * the name), render a single label and skip the redundant hint.
 *
 * Dynamic-kind options (#517) carry a muted suffix explaining the runtime
 * behaviour. Suffix lives outside the mono id-hint span so it stays in
 * the body sans, not the monospace id treatment.
 */
function renderOptionLabel(option: MappingOption): ReactNode {
  const dynamicSuffix =
    option.kind === 'dynamic' ? (
      <span className="mapping-option__dynamic-suffix">{DYNAMIC_OPTION_SUFFIX}</span>
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
 * Plain-text variant for `<option>` elements — native `<select>` strips
 * styled children, so the id chip is approximated as parenthesised text
 * and the dynamic-kind cue is appended as a label suffix (#517).
 */
function optionPlainText(option: MappingOption): string {
  const base =
    option.label === option.value
      ? option.label
      : `${option.label} (${shortValue(option.value)})`;
  return option.kind === 'dynamic' ? `${base}${DYNAMIC_OPTION_SUFFIX}` : base;
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
  focusSourceValue,
  focusSourceName,
}: MappingPanelProps): ReactElement {
  const [localRows, setLocalRows] = useState<MappingRow[]>(savedRows);
  const [pendingSource, setPendingSource] = useState('');
  const [pendingTarget, setPendingTarget] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [focusApplied, setFocusApplied] = useState(false);
  const sourceSelectRef = useRef<HTMLSelectElement>(null);

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

  // Deep-link pre-focus (#1794): once options have loaded, pre-select the
  // requested source value in the add-row form and scroll/focus it. Runs at
  // most once, and no-ops when the method is already mapped or unknown.
  useEffect(() => {
    if (focusApplied || !focusSourceValue || optionsLoading || optionsError) return;
    setFocusApplied(true);
    const inSource = sourceOptions.some((o) => o.value === focusSourceValue);
    const alreadyMapped = savedRows.some((r) => r.sourceValue === focusSourceValue);
    if (!inSource || alreadyMapped) return;
    setPendingSource(focusSourceValue);
    const el = sourceSelectRef.current;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus();
    }
  }, [focusApplied, focusSourceValue, optionsLoading, optionsError, sourceOptions, savedRows]);

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

  // Deep-link pre-focus target (#1794) is "actionable" only while it remains an
  // unmapped, known source value — drives the hint copy + select highlight.
  const focusActionable = Boolean(
    focusSourceValue &&
      sourceOptions.some((o) => o.value === focusSourceValue) &&
      !localRows.some((r) => r.sourceValue === focusSourceValue),
  );
  const focusLabel = focusSourceName ?? focusSourceValue ?? '';

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

      {/* Suppressed while the deep-link focus hint (#1794) is showing below —
          otherwise two role="status" live regions would announce together
          for a connection with zero carrier mappings and an unmapped method. */}
      {localRows.length === 0 && !focusActionable ? (
        <p className="muted-text" role="status" aria-live="polite">
          No mappings configured yet. Orders may sync with default values. Add one below.
        </p>
      ) : localRows.length === 0 ? null : (
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

      {/* Deep-link pre-focus hint (#1794) */}
      {focusActionable && (
        <p className="mapping-panel__focus-hint" role="status" aria-live="polite">
          Map <strong>{focusLabel}</strong> to a {targetLabel.toLowerCase()} below.
        </p>
      )}

      {/* Add row form */}
      <div className="toolbar" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <select
          ref={sourceSelectRef}
          aria-label={`Select ${sourceLabel}`}
          className={focusActionable ? 'mapping-panel__source-select--focus' : undefined}
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
