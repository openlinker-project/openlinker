/**
 * View Dialogs
 *
 * The three modal moments of a view: save as new (name, who can see it, open by
 * default, a summary of what is saved), rename, and delete. Presentational; the
 * caller's `onSubmit` reports whether the server accepted the name.
 *
 * @module apps/web/src/features/saved-views/components
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { interpolate } from '../../../shared/i18n/interpolate';
import { useMessages } from '../../../shared/i18n/use-messages';
import { usePlural } from '../../../shared/i18n/use-plural';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import type { ListView, StoredViewScope } from '../lib/saved-view.types';
import { isNameTaken, VIEW_NAME_MAX_LENGTH } from '../lib/view-name';

export type ViewDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; view: ListView }
  | { mode: 'delete'; view: ListView };

export type SubmitOutcome = 'ok' | 'taken' | 'error';

export interface SaveSummary {
  /** Already worded, e.g. "Stage: Sync failed". */
  filters: string[];
  sortLabel: string;
  /** Visible columns including the locked first one. */
  columnCount: number;
}

export interface ViewDialogsProps {
  dialog: ViewDialogState | null;
  views: ListView[];
  isAdmin: boolean;
  /** The list's name, used in "Open {page} in this view by default". */
  pageTitle: string;
  summary: SaveSummary;
  /** The active view has unsaved changes that deleting it would also drop. */
  activeHasUnsavedChanges: boolean;
  activeId: string;
  onClose: () => void;
  onCreate: (input: { name: string; scope: StoredViewScope; asDefault: boolean }) => Promise<SubmitOutcome>;
  onRename: (view: ListView, name: string) => Promise<SubmitOutcome>;
  onDelete: (view: ListView) => void;
}

function SaveForm({
  mode,
  view,
  props,
}: {
  mode: 'create' | 'rename';
  view?: ListView;
  props: ViewDialogsProps;
}): ReactElement {
  const all = useMessages('saved-views');
  const copy = all.saveDialog;
  const plural = usePlural();
  const nameId = useId();
  const errorId = useId();
  const [name, setName] = useState(mode === 'rename' ? (view?.name ?? '') : '');
  const [scope, setScope] = useState<StoredViewScope>('personal');
  const [asDefault, setAsDefault] = useState(false);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<'taken' | 'error' | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const clash = isNameTaken(trimmed, props.views, view?.id);
  const error = !trimmed ? copy.errors.required : clash ? copy.errors.taken : serverError === 'taken' ? copy.errors.taken : '';
  const effectiveScope = mode === 'rename' ? view?.scope : scope;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setTouched(true);
    if (error || saving) return;
    setSaving(true);
    const outcome =
      mode === 'rename' && view
        ? await props.onRename(view, trimmed)
        : await props.onCreate({ name: trimmed, scope, asDefault: scope === 'personal' && asDefault });
    setSaving(false);
    if (outcome !== 'ok') setServerError(outcome);
  };

  return (
    <form className="sv-dialog-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="sv-field">
        <label className="sv-field__label" htmlFor={nameId}>
          {copy.nameLabel}
        </label>
        <Input
          id={nameId}
          autoFocus
          value={name}
          maxLength={VIEW_NAME_MAX_LENGTH}
          invalid={touched && !!error}
          aria-invalid={touched && !!error}
          aria-describedby={touched && error ? errorId : undefined}
          placeholder={copy.namePlaceholder}
          onChange={(event) => {
            setName(event.target.value);
            setServerError(null);
          }}
        />
        {touched && error ? (
          <span id={errorId} className="sv-field__error">
            {error}
          </span>
        ) : null}
      </div>
      {mode === 'create' ? (
        <>
          <div className="sv-field">
            <span className="sv-field__label">{copy.scopeLabel}</span>
            <SegmentedControl<StoredViewScope>
              aria-label={copy.scopeLabel}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'personal', label: copy.onlyMe },
                { value: 'shared', label: copy.everyone, disabled: !props.isAdmin },
              ]}
            />
            <span className="sv-field__hint">
              {!props.isAdmin ? copy.scopeHint.viewer : scope === 'shared' ? copy.scopeHint.shared : copy.scopeHint.personal}
            </span>
          </div>
          {effectiveScope === 'personal' ? (
            <label className="sv-checkrow">
              <input type="checkbox" checked={asDefault} onChange={(event) => setAsDefault(event.target.checked)} />
              {interpolate(copy.defaultCheck, { page: props.pageTitle })}
            </label>
          ) : null}
          <div className="sv-summary" aria-label={copy.summary.label}>
            {props.summary.filters.map((chip) => (
              <span key={chip} className="sv-summary__chip">
                {chip}
              </span>
            ))}
            <span className="sv-summary__chip">{interpolate(copy.summary.sort, { label: props.summary.sortLabel })}</span>
            <span className="sv-summary__chip">
              {plural(props.summary.columnCount, copy.summary.columns, { n: props.summary.columnCount })}
            </span>
          </div>
        </>
      ) : null}
      <DialogFooter>
        <Button type="button" tone="secondary" onClick={props.onClose}>
          {copy.cancel}
        </Button>
        <Button type="submit" disabled={saving}>
          {mode === 'rename' ? copy.saveName : copy.saveView}
        </Button>
      </DialogFooter>
      {serverError === 'error' ? <span className="sv-field__error">{all.errors.generic}</span> : null}
    </form>
  );
}

export function ViewDialogs(props: ViewDialogsProps): ReactElement {
  const copy = useMessages('saved-views');
  const { dialog } = props;
  const saveMode = dialog && dialog.mode !== 'delete' ? dialog : null;

  return (
    <>
      <Dialog open={saveMode !== null} onOpenChange={(open) => (open ? undefined : props.onClose())}>
        {saveMode ? (
          <DialogContent>
            <DialogTitle>
              {saveMode.mode === 'rename' ? copy.saveDialog.renameTitle : copy.saveDialog.createTitle}
            </DialogTitle>
            <DialogDescription>
              {saveMode.mode === 'rename' ? copy.saveDialog.renameDescription : copy.saveDialog.createDescription}
            </DialogDescription>
            <SaveForm
              key={saveMode.mode === 'rename' ? saveMode.view.id : 'create'}
              mode={saveMode.mode}
              view={saveMode.mode === 'rename' ? saveMode.view : undefined}
              props={props}
            />
          </DialogContent>
        ) : null}
      </Dialog>
      {dialog?.mode === 'delete' ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? undefined : props.onClose())}
          tone="danger"
          title={interpolate(copy.deleteDialog.title, { name: dialog.view.name })}
          description={[
            dialog.view.scope === 'shared' ? copy.deleteDialog.sharedWarning : '',
            dialog.view.id === props.activeId && props.activeHasUnsavedChanges ? copy.deleteDialog.unsavedWarning : '',
            copy.deleteDialog.body,
          ]
            .filter(Boolean)
            .join(' ')}
          confirmLabel={copy.deleteDialog.confirm}
          initialFocus="cancel"
          onConfirm={() => props.onDelete(dialog.view)}
        />
      ) : null}
    </>
  );
}
