/**
 * Order Column Preset Manager (#3530, D32, #3507 PR 7)
 *
 * The body of the `/orders` list's Columns panel (`.columns-panel`, hosted by
 * `OrderColumnVisibilityControl`): apply / save / delete a personal column
 * preset, tick columns on and off, and reorder the ticked ones.
 *
 * `availableColumns` is the vocabulary this manager may touch. A saved
 * preset's `columns` array is a shared shape (#3530) that may also carry the
 * EXPORT's ids; those are never rendered here and are carried through every
 * change untouched, exactly as the export job's `narrowOrderExportColumns`
 * skips an id it does not know.
 *
 * One list, in table order: ticked columns first (with up/down buttons — the
 * order IS the table's column order, and arrow buttons need no drag library),
 * then the hidden ones, greyed, at the end. Ticking a hidden column appends it.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import {
  useCreateColumnPresetMutation,
  useDeleteColumnPresetMutation,
  useOrderColumnPresetsQuery,
  useSetWorkspaceDefaultColumnPresetMutation,
} from '../hooks/use-order-column-presets';
import { ORDER_COLUMNS_PANEL_COPY as COPY } from '../lib/order-export.copy';

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
}

export function OrderColumnPresetManager({
  availableColumns,
  columns,
  onColumnsChange,
}: OrderColumnPresetManagerProps): ReactElement {
  const isAdmin = useIsAdmin();
  const presetsQuery = useOrderColumnPresetsQuery();
  const createPreset = useCreateColumnPresetMutation();
  const deletePreset = useDeleteColumnPresetMutation();
  const setWorkspaceDefault = useSetWorkspaceDefaultColumnPresetMutation();
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const knownIds = new Set(availableColumns.map((c) => c.id));
  const labelFor = (id: string): string => availableColumns.find((c) => c.id === id)?.label ?? id;
  const visible = columns.filter((id) => knownIds.has(id));
  const hidden = availableColumns.filter((c) => !visible.includes(c.id)).map((c) => c.id);
  const presets = presetsQuery.data ?? [];
  const selectedPreset = presets.find((p) => p.id === selectedPresetId) ?? null;

  function replaceKnownColumns(nextVisible: string[]): void {
    // Ids from the other vocabulary ride along untouched — toggling a list
    // column must never drop an export column sitting in the same array.
    const foreign = columns.filter((id) => !knownIds.has(id));
    onColumnsChange([...nextVisible, ...foreign]);
  }

  function toggle(id: string, checked: boolean): void {
    replaceKnownColumns(checked ? [...visible, id] : visible.filter((v) => v !== id));
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
    const preset = presets.find((p) => p.id === id);
    if (preset) onColumnsChange(preset.columns);
  }

  function closeSaveRow(): void {
    setSaving(false);
    setNewPresetName('');
    createPreset.reset();
  }

  function saveAsPreset(): void {
    const name = newPresetName.trim();
    if (!name) return;
    createPreset.mutate(
      { name, columns: [...columns] },
      {
        onSuccess: (preset) => {
          setSelectedPresetId(preset.id);
          setSaving(false);
          setNewPresetName('');
        },
      },
    );
  }

  return (
    <>
      <div className="columns-panel__presets">
        <FormField label={COPY.preset} name="orders-columns-preset">
          <Select
            value={selectedPresetId}
            onChange={(e) => { applyPreset(e.target.value); }}
          >
            <option value="">{COPY.presetCustom}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FormField>
        {presetsQuery.isError ? (
          <p className="form-field__description columns-panel__note">{COPY.presetsLoadError}</p>
        ) : null}
        {saving ? (
          <div className="columns-panel__save">
            <Input
              aria-label={COPY.presetName}
              placeholder={COPY.presetName}
              value={newPresetName}
              autoFocus
              onChange={(e) => { setNewPresetName(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveAsPreset(); }
              }}
            />
            <Button
              tone="secondary"
              className="button--sm"
              onClick={saveAsPreset}
              disabled={!newPresetName.trim() || createPreset.isPending}
            >
              {COPY.save}
            </Button>
            <Button tone="ghost" className="button--sm" onClick={closeSaveRow}>
              {COPY.cancel}
            </Button>
            {createPreset.isError ? (
              <p className="form-field__error columns-panel__note">{COPY.saveError}</p>
            ) : null}
          </div>
        ) : (
          <div className="columns-panel__actions">
            <Button tone="ghost" className="button--sm" onClick={() => { setSaving(true); }}>
              {COPY.saveAsPreset}
            </Button>
            {selectedPreset ? (
              <Button tone="ghost" className="button--sm" onClick={() => { setConfirmingDelete(true); }}>
                {COPY.deletePreset}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <ul className="columns-panel__list" aria-label={COPY.listLabel}>
        {visible.map((id, index) => (
          <li key={id} className="columns-panel__item">
            <label className="columns-panel__check">
              <input type="checkbox" checked onChange={(e) => { toggle(id, e.target.checked); }} />
              <span>{labelFor(id)}</span>
            </label>
            <span className="columns-panel__move">
              <Button
                tone="ghost"
                className="button--xs columns-panel__move-button"
                aria-label={COPY.moveUp(labelFor(id))}
                disabled={index === 0}
                onClick={() => { move(id, -1); }}
              >
                ↑
              </Button>
              <Button
                tone="ghost"
                className="button--xs columns-panel__move-button"
                aria-label={COPY.moveDown(labelFor(id))}
                disabled={index === visible.length - 1}
                onClick={() => { move(id, 1); }}
              >
                ↓
              </Button>
            </span>
          </li>
        ))}
        {hidden.map((id) => (
          <li key={id} className="columns-panel__item columns-panel__item--hidden">
            <label className="columns-panel__check">
              <input type="checkbox" checked={false} onChange={(e) => { toggle(id, e.target.checked); }} />
              <span>{labelFor(id)}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="columns-panel__foot">
        <span className="text-muted">{COPY.footHint}</span>
        {isAdmin ? (
          <Button
            tone="ghost"
            className="button--xs"
            disabled={setWorkspaceDefault.isPending}
            onClick={() => { setWorkspaceDefault.mutate([...columns]); }}
          >
            {setWorkspaceDefault.isSuccess ? COPY.workspaceDefaultSaved : COPY.setWorkspaceDefault}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={COPY.deleteTitle}
        description={COPY.deleteDescription(selectedPreset?.name ?? '')}
        confirmLabel={COPY.deleteConfirm}
        tone="danger"
        isConfirming={deletePreset.isPending}
        onConfirm={() => {
          if (!selectedPreset) return;
          deletePreset.mutate(selectedPreset.id, {
            onSuccess: () => {
              setSelectedPresetId('');
              setConfirmingDelete(false);
            },
          });
        }}
      />
    </>
  );
}
