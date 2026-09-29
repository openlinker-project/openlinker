/**
 * Order Column Preset Manager (#3530, D32)
 *
 * Save / apply / delete a personal column preset, shared by the export
 * dialog and the `/orders` list's own column-visibility control
 * (`OrderColumnVisibilityControl`) — one component, parameterized by
 * `availableColumns`, so "the orders list and the export share the same
 * preset shape" (#3530's own docblock) is true of the EDITOR too, not just
 * of the wire shape. The two callers pass disjoint id vocabularies
 * (`ORDER_EXPORT_COLUMN_IDS` vs `ORDER_LIST_COLUMN_IDS`), so one saved
 * preset's `columns` array can freely mix both — each caller narrows to the
 * ids it recognises and ignores the rest, exactly as the export job's
 * `narrowOrderExportColumns` already does for an unrecognised id.
 *
 * Visible columns are listed in ORDER with Up/Down buttons (reorder), and
 * hidden ones are listed separately with an Add button — a stable, no-DnD-
 * library way to satisfy "show/hide/reorder" that still keys off one
 * `columns: string[]` array, matching the preset's own persisted shape.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import {
  useCreateColumnPresetMutation,
  useDeleteColumnPresetMutation,
  useOrderColumnPresetsQuery,
  useSetWorkspaceDefaultColumnPresetMutation,
} from '../hooks/use-order-column-presets';

export interface OrderColumnDescriptor {
  id: string;
  label: string;
}

export interface OrderColumnPresetManagerProps {
  /** The full set this manager may toggle/reorder, in their DEFAULT order. */
  availableColumns: readonly OrderColumnDescriptor[];
  /** The columns currently in effect, in the order they should render. */
  columns: readonly string[];
  onColumnsChange: (columns: string[]) => void;
  /** Renders the reorder/save/delete affordances. `false` for a read-mostly embed (unused today, kept for symmetry with the export dialog's own gating). */
  canWrite?: boolean;
}

export function OrderColumnPresetManager({
  availableColumns,
  columns,
  onColumnsChange,
  canWrite = true,
}: OrderColumnPresetManagerProps): ReactElement {
  const isAdmin = useIsAdmin();
  const presetsQuery = useOrderColumnPresetsQuery();
  const createPreset = useCreateColumnPresetMutation();
  const deletePreset = useDeleteColumnPresetMutation();
  const setWorkspaceDefault = useSetWorkspaceDefaultColumnPresetMutation();
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [newPresetName, setNewPresetName] = useState('');

  const labelFor = (id: string): string => availableColumns.find((c) => c.id === id)?.label ?? id;
  // Only the ids THIS manager recognises count as "visible" — a mixed
  // preset's export-shaped ids (say) are simply not this manager's concern.
  const knownIds = new Set(availableColumns.map((c) => c.id));
  const visible = columns.filter((id) => knownIds.has(id));
  const hidden = availableColumns.filter((c) => !visible.includes(c.id));

  function replaceKnownColumns(nextVisible: string[]): void {
    // Preserve any id from OTHER vocabularies the current preset carries
    // (e.g. the export's ids when this is the list's manager) — toggling a
    // list column must never silently drop an export column id sitting in
    // the same shared array.
    const foreign = columns.filter((id) => !knownIds.has(id));
    onColumnsChange([...nextVisible, ...foreign]);
  }

  function show(id: string): void {
    replaceKnownColumns([...visible, id]);
  }

  function hide(id: string): void {
    replaceKnownColumns(visible.filter((v) => v !== id));
  }

  function move(id: string, delta: 1 | -1): void {
    const index = visible.indexOf(id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= visible.length) return;
    const next = [...visible];
    [next[index], next[target]] = [next[target], next[index]];
    replaceKnownColumns(next);
  }

  function applyPreset(id: string): void {
    setSelectedPresetId(id);
    const preset = presetsQuery.data?.find((p) => p.id === id);
    if (preset) onColumnsChange(preset.columns);
  }

  function saveAsPreset(): void {
    if (!newPresetName.trim()) return;
    createPreset.mutate(
      { name: newPresetName.trim(), columns: [...columns] },
      { onSuccess: () => { setNewPresetName(''); } },
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <label className="orders-toolbar__field">
        <span className="orders-toolbar__label">Saved presets</span>
        <Select
          aria-label="Apply a saved column preset"
          value={selectedPresetId}
          disabled={!canWrite}
          onChange={(e) => { applyPreset(e.target.value); }}
        >
          <option value="">Custom</option>
          {(presetsQuery.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {canWrite && selectedPresetId ? (
          <Button
            tone="ghost"
            className="button--xs"
            onClick={() => {
              deletePreset.mutate(selectedPresetId);
              setSelectedPresetId('');
            }}
          >
            Delete preset
          </Button>
        ) : null}
      </label>

      <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
        <span className="orders-toolbar__label">Visible columns (in order)</span>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '2px' }}>
          {visible.map((id, index) => (
            <li
              key={id}
              className="ds-row"
              style={{ justifyContent: 'space-between', gap: 'var(--space-2)' }}
            >
              <span>{labelFor(id)}</span>
              <span className="toolbar__group">
                <Button
                  tone="ghost"
                  className="button--xs"
                  aria-label={`Move ${labelFor(id)} up`}
                  disabled={!canWrite || index === 0}
                  onClick={() => { move(id, -1); }}
                >
                  ↑
                </Button>
                <Button
                  tone="ghost"
                  className="button--xs"
                  aria-label={`Move ${labelFor(id)} down`}
                  disabled={!canWrite || index === visible.length - 1}
                  onClick={() => { move(id, 1); }}
                >
                  ↓
                </Button>
                <Button
                  tone="ghost"
                  className="button--xs"
                  disabled={!canWrite}
                  onClick={() => { hide(id); }}
                >
                  Hide
                </Button>
              </span>
            </li>
          ))}
        </ul>

        {hidden.length > 0 ? (
          <>
            <span className="orders-toolbar__label">Hidden</span>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '2px' }}>
              {hidden.map((c) => (
                <li key={c.id} className="ds-row" style={{ justifyContent: 'space-between' }}>
                  <span className="text-muted">{c.label}</span>
                  <Button tone="ghost" className="button--xs" disabled={!canWrite} onClick={() => { show(c.id); }}>
                    Show
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {canWrite ? (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Input
            aria-label="New preset name"
            placeholder="Preset name"
            value={newPresetName}
            onChange={(e) => { setNewPresetName(e.target.value); }}
          />
          <Button tone="secondary" className="button--sm" onClick={saveAsPreset} disabled={!newPresetName.trim()}>
            Save as preset
          </Button>
          {isAdmin ? (
            <Button
              tone="ghost"
              className="button--sm"
              onClick={() => { setWorkspaceDefault.mutate([...columns]); }}
            >
              Set as workspace default
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
