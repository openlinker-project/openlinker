/**
 * Order Notes Panel (#3531/#3533, mockup M3)
 *
 * Internal, office-facing notes on an order detail page: the thread, the add
 * form, and per-note edit/delete gated by D33 (the author edits/deletes their
 * own; an admin may delete any). "Show to packer" carries the PII warning the
 * mockup requires — the text reaches the shared pack-bench terminal.
 *
 * Scope note: this pass ships the thread, add, edit, delete and the
 * showToPacker flag. The mockup's "pin one note full-width under the header"
 * treatment is NOT implemented here — no pin field exists on the backend
 * (#3531 shipped without it) — so every note renders in this one panel.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Textarea } from '../../../shared/ui/textarea';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { useSession } from '../../../shared/auth/use-session';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import type { OrderNote } from '../api/orders.types';
import { useOrderNotesQuery } from '../hooks/use-order-notes-query';
import {
  useCreateOrderNoteMutation,
  useDeleteOrderNoteMutation,
  useUpdateOrderNoteMutation,
} from '../hooks/use-order-note-mutations';

const NOTE_MAX_LENGTH = 2000;

export interface OrderNotesPanelProps {
  internalOrderId: string;
}

function NoteRow({
  note,
  internalOrderId,
  currentUserId,
  isAdmin,
  canWrite,
}: {
  note: OrderNote;
  internalOrderId: string;
  currentUserId: string | undefined;
  isAdmin: boolean;
  canWrite: boolean;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [showToPackerDraft, setShowToPackerDraft] = useState(note.showToPacker);
  const updateNote = useUpdateOrderNoteMutation(internalOrderId);
  const deleteNote = useDeleteOrderNoteMutation(internalOrderId);

  const isAuthor = currentUserId !== undefined && currentUserId === note.authorUserId;
  const canEdit = canWrite && isAuthor;
  const canDelete = canWrite && (isAuthor || isAdmin);

  function startEdit(): void {
    setDraft(note.body);
    setShowToPackerDraft(note.showToPacker);
    setEditing(true);
  }

  function saveEdit(): void {
    if (!draft.trim()) return;
    updateNote.mutate(
      { noteId: note.id, body: { body: draft, showToPacker: showToPackerDraft } },
      { onSuccess: () => { setEditing(false); } },
    );
  }

  return (
    <li className="order-note-row">
      <div className="order-note-row__meta">
        <span className="mono-text">{note.authorUsername}</span>
        <TimeDisplay iso={note.createdAt} format="datetime" />
        {note.editedAt ? <span className="order-note-row__edited">edited</span> : null}
        {note.showToPacker ? <span className="order-note-row__flag">Show to packer</span> : null}
      </div>

      {editing ? (
        <div className="order-note-row__edit">
          <Textarea
            aria-label="Edit note"
            value={draft}
            maxLength={NOTE_MAX_LENGTH}
            onChange={(e) => { setDraft(e.target.value); }}
          />
          <label className="order-note-row__packer-toggle">
            <input
              type="checkbox"
              checked={showToPackerDraft}
              onChange={(e) => { setShowToPackerDraft(e.target.checked); }}
            />
            Show to packer
          </label>
          {updateNote.isError ? (
            <Alert tone="error">
              {updateNote.error.message || 'Could not save the edit. Try again.'}
            </Alert>
          ) : null}
          <div className="order-note-row__actions">
            <Button
              onClick={saveEdit}
              disabled={!draft.trim() || updateNote.isPending}
            >
              Save
            </Button>
            <Button tone="ghost" onClick={() => { setEditing(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="order-note-row__body">{note.body}</p>
      )}

      {!editing && (canEdit || canDelete) ? (
        <div className="order-note-row__actions">
          {canEdit ? (
            <Button tone="ghost" onClick={startEdit}>
              Edit
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              tone="ghost"
              onClick={() => { deleteNote.mutate(note.id); }}
              disabled={deleteNote.isPending}
            >
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function OrderNotesPanel({ internalOrderId }: OrderNotesPanelProps): ReactElement {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const isAdmin = useIsAdmin();
  const canAct = write.canWrite || write.demoReadOnly;
  const { session } = useSession();
  const currentUserId = session.user?.id;

  const notesQuery = useOrderNotesQuery(internalOrderId);
  const createNote = useCreateOrderNoteMutation(internalOrderId);

  const [newBody, setNewBody] = useState('');
  const [newShowToPacker, setNewShowToPacker] = useState(false);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!newBody.trim()) return;
    createNote.mutate(
      { body: newBody, showToPacker: newShowToPacker },
      {
        onSuccess: () => {
          setNewBody('');
          setNewShowToPacker(false);
        },
      },
    );
  }

  const notes = notesQuery.data ?? [];

  return (
    <section className="panel order-notes-panel" aria-labelledby="order-notes-heading">
      <h3 id="order-notes-heading">Notes</h3>

      {notesQuery.isLoading ? (
        <p className="muted-text">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="muted-text">
          No notes yet. Notes are internal — visible to office roles, never the buyer.
        </p>
      ) : (
        <ul className="order-notes-panel__list">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              internalOrderId={internalOrderId}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              canWrite={canAct}
            />
          ))}
        </ul>
      )}

      {canAct ? (
        <form className="order-notes-panel__form" onSubmit={handleSubmit}>
          <Textarea
            aria-label="Add a note"
            placeholder="Add an internal note…"
            value={newBody}
            maxLength={NOTE_MAX_LENGTH}
            disabled={write.demoReadOnly}
            onChange={(e) => { setNewBody(e.target.value); }}
          />
          <div className="order-notes-panel__form-row">
            <label className="order-note-row__packer-toggle">
              <input
                type="checkbox"
                checked={newShowToPacker}
                disabled={write.demoReadOnly}
                onChange={(e) => { setNewShowToPacker(e.target.checked); }}
              />
              Show to packer
            </label>
            <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
              <Button
                type="submit"
                disabled={write.demoReadOnly || !newBody.trim() || createNote.isPending}
              >
                Add note
              </Button>
            </ReadOnlyLock>
          </div>
          {newShowToPacker ? (
            <p className="order-notes-panel__pii-warning muted-text">
              This text will be visible on the shared pack-bench terminal. Do not include
              information you would not want a packer to see.
            </p>
          ) : null}
          {createNote.isError ? (
            <Alert tone="error">
              {createNote.error.message || 'Could not save the note. Try again.'}
            </Alert>
          ) : null}
        </form>
      ) : (
        <p className="muted-text">Adding a note needs the operator or admin role.</p>
      )}
    </section>
  );
}
