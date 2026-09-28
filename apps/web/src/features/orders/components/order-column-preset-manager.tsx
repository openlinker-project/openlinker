/**
 * Order Column Preset Manager (#3530, D32)
 *
 * Save / apply / delete a personal column preset, shared by the export
 * dialog and (per #3530's own docblock) the orders list itself — this
 * component owns the picker's logic so a later list-column-visibility pass
 * can mount it unchanged. An admin may additionally save the workspace
 * default, which every user with no preset of their own starts from.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import { ORDER_EXPORT_COLUMN_IDS, ORDER_EXPORT_COLUMN_LABELS } from '../api/orders.types';
import {
  useCreateColumnPresetMutation,
  useDeleteColumnPresetMutation,
  useOrderColumnPresetsQuery,
  useSetWorkspaceDefaultColumnPresetMutation,
} from '../hooks/use-order-column-presets';

export interface OrderColumnPresetManagerProps {
  /** The columns currently in effect — starts at the export's own default set. */
  columns: readonly string[];
  onColumnsChange: (columns: string[]) => void;
}

export function OrderColumnPresetManager({
  columns,
  onColumnsChange,
}: OrderColumnPresetManagerProps): ReactElement {
  const isAdmin = useIsAdmin();
  const presetsQuery = useOrderColumnPresetsQuery();
  const createPreset = useCreateColumnPresetMutation();
  const deletePreset = useDeleteColumnPresetMutation();
  const setWorkspaceDefault = useSetWorkspaceDefaultColumnPresetMutation();
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [newPresetName, setNewPresetName] = useState('');

  function toggleColumn(id: string): void {
    onColumnsChange(
      columns.includes(id) ? columns.filter((c) => c !== id) : [...columns, id],
    );
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
          onChange={(e) => { applyPreset(e.target.value); }}
        >
          <option value="">Custom</option>
          {(presetsQuery.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {selectedPresetId ? (
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

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--space-1)' }}>
        <legend className="orders-toolbar__label">Columns</legend>
        {ORDER_EXPORT_COLUMN_IDS.map((id) => (
          <label key={id} className="ack-row ack-row--inline">
            <input type="checkbox" checked={columns.includes(id)} onChange={() => { toggleColumn(id); }} />
            <span>{ORDER_EXPORT_COLUMN_LABELS[id]}</span>
          </label>
        ))}
      </fieldset>

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
    </div>
  );
}
