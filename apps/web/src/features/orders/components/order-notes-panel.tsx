/**
 * Order Notes Panel (#3531/#3533, mockup M3)
 *
 * Internal, office-facing notes on an order detail page, laid out as a
 * `detail-section` beside Summary and Hold: the title row (count + who can see
 * them), the composer ABOVE the thread, then the thread with per-note
 * edit/pin/delete inline on each note's head line. Edit is author-only; pin and
 * delete are author-or-admin (D33's shape, extended to pin per the epic's
 * recovery pass). "Show to packer" carries the PII warning the mockup requires
 * — the text reaches the shared pack-bench terminal. Delete asks first: the
 * text is gone for everyone, the pack bench included.
 *
 * The pinned note (at most one per order, server-enforced) ALSO renders in its
 * own full-width slot under the order header ({@link PinnedOrderNoteBanner}) —
 * the thread is the complete list, the slot is a shortcut to it.
 *
 * @module apps/web/src/features/orders/components
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EmptyState, LoadingState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Textarea } from '../../../shared/ui/textarea';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { useSession } from '../../../shared/auth/use-session';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import type { OrderNote } from '../api/orders.types';
import { useOrderNotesQuery } from '../hooks/use-order-notes-query';
import {
  useCreateOrderNoteMutation,
  useDeleteOrderNoteMutation,
  usePinOrderNoteMutation,
  useUnpinOrderNoteMutation,
  useUpdateOrderNoteMutation,
} from '../hooks/use-order-note-mutations';
import { ORDER_NOTE_MAX_LENGTH, ORDER_NOTES_COPY } from '../lib/order-notes.copy';

/** The `id` the pinned banner's "All notes (n)" link and the page hash-scroll target. */
export const ORDER_NOTES_SECTION_ID = 'order-notes';

const COPY = ORDER_NOTES_COPY;

export interface OrderNotesPanelProps {
  internalOrderId: string;
  /**
   * The order's channels (source + destinations) by display name, for the
   * "Never sent to …" promise. Empty or absent reads "your sales channels".
   */
  channelNames?: readonly string[];
}

function isSameLocalDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function NoteRow({
  note,
  internalOrderId,
  currentUserId,
  isAdmin,
  canWrite,
  onRequestDelete,
}: {
  note: OrderNote;
  internalOrderId: string;
  currentUserId: string | undefined;
  isAdmin: boolean;
  canWrite: boolean;
  onRequestDelete: (note: OrderNote) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [showToPackerDraft, setShowToPackerDraft] = useState(note.showToPacker);
  const editorId = useId();
  const { showToast } = useToast();
  const updateNote = useUpdateOrderNoteMutation(internalOrderId);
  const pinNote = usePinOrderNoteMutation(internalOrderId);
  const unpinNote = useUnpinOrderNoteMutation(internalOrderId);

  const isAuthor = currentUserId !== undefined && currentUserId === note.authorUserId;
  const canEdit = canWrite && isAuthor;
  const canDelete = canWrite && (isAuthor || isAdmin);
  // Same author-or-admin shape as delete (D33), extended to pin.
  const canPin = canWrite && (isAuthor || isAdmin);
  const isPinned = note.pinnedAt !== null;

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

  function togglePin(): void {
    const onError = (error: Error): void => {
      showToast({
        tone: 'error',
        title: COPY.row.actionErrorTitle,
        description: error.message || COPY.row.actionErrorFallback,
      });
    };
    if (isPinned) unpinNote.mutate(note.id, { onError });
    else pinNote.mutate(note.id, { onError });
  }

  const showActions = !editing && (canEdit || canPin || canDelete);

  return (
    <li className="order-note">
      <div className="order-note__head">
        <span className="order-note__author">{note.authorUsername}</span>
        <TimeDisplay iso={note.createdAt} format="datetime" className="mono-text" />
        {note.editedAt ? (
          <span>
            {COPY.row.edited}{' '}
            <TimeDisplay
              iso={note.editedAt}
              format={isSameLocalDay(note.editedAt, note.createdAt) ? 'time' : 'datetime'}
            />
          </span>
        ) : null}
        {isPinned ? (
          <StatusBadge tone="neutral" compact>
            {COPY.row.pinned}
          </StatusBadge>
        ) : null}
        {note.showToPacker ? (
          <StatusBadge tone="neutral" compact>
            {COPY.row.shownToPacker}
          </StatusBadge>
        ) : null}
        {showActions ? (
          <span className="order-note__actions">
            {canEdit ? (
              <Button tone="ghost" className="button--xs" onClick={startEdit}>
                {COPY.row.edit}
              </Button>
            ) : null}
            {canPin ? (
              <Button
                tone="ghost"
                className="button--xs"
                onClick={togglePin}
                disabled={pinNote.isPending || unpinNote.isPending}
              >
                {isPinned ? COPY.row.unpin : COPY.row.pin}
              </Button>
            ) : null}
            {canDelete ? (
              <Button tone="ghost" className="button--xs" onClick={() => { onRequestDelete(note); }}>
                {COPY.row.delete}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>

      {editing ? (
        <div className="order-note__editor">
          <label className="sr-only" htmlFor={editorId}>
            {COPY.row.editLabel}
          </label>
          <Textarea
            id={editorId}
            rows={3}
            value={draft}
            maxLength={ORDER_NOTE_MAX_LENGTH}
            onChange={(e) => { setDraft(e.target.value); }}
            autoFocus
          />
          <div className="order-note__editor-foot">
            <Button
              className="button--sm"
              onClick={saveEdit}
              disabled={!draft.trim() || updateNote.isPending}
            >
              {COPY.row.save}
            </Button>
            <Button tone="ghost" className="button--sm" onClick={() => { setEditing(false); }}>
              {COPY.row.cancel}
            </Button>
            <span className="order-note__editor-hint">{COPY.row.editHint}</span>
            <label className="ack-row ack-row--inline">
              <input
                type="checkbox"
                checked={showToPackerDraft}
                onChange={(e) => { setShowToPackerDraft(e.target.checked); }}
              />
              <span>{COPY.composer.showToPacker}</span>
            </label>
            <span className="order-notes__counter">{COPY.composer.counter(draft.length)}</span>
          </div>
          {showToPackerDraft ? (
            <p className="order-notes__packer-warning">{COPY.composer.packerWarning}</p>
          ) : null}
          {updateNote.isError ? (
            <Alert tone="error" title={COPY.row.editErrorTitle}>
              {updateNote.error.message || COPY.row.editErrorFallback}
            </Alert>
          ) : null}
        </div>
      ) : (
        <p className="order-note__body">{note.body}</p>
      )}
    </li>
  );
}

export function OrderNotesPanel({ internalOrderId, channelNames = [] }: OrderNotesPanelProps): ReactElement {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const isAdmin = useIsAdmin();
  const canAct = write.canWrite || write.demoReadOnly;
  const { session } = useSession();
  const currentUserId = session.user?.id;
  const { showToast } = useToast();
  const composerId = useId();

  const notesQuery = useOrderNotesQuery(internalOrderId);
  const createNote = useCreateOrderNoteMutation(internalOrderId);
  const pinNote = usePinOrderNoteMutation(internalOrderId);
  const deleteNote = useDeleteOrderNoteMutation(internalOrderId);

  const [newBody, setNewBody] = useState('');
  const [newShowToPacker, setNewShowToPacker] = useState(false);
  const [newPinToTop, setNewPinToTop] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<OrderNote | null>(null);

  function submitNote(): void {
    if (!newBody.trim() || createNote.isPending) return;
    const pinAfterCreate = newPinToTop;
    createNote.mutate(
      { body: newBody, showToPacker: newShowToPacker },
      {
        onSuccess: (created) => {
          setNewBody('');
          setNewShowToPacker(false);
          setNewPinToTop(false);
          if (pinAfterCreate) {
            pinNote.mutate(created.id, {
              onError: (error) => {
                showToast({
                  tone: 'error',
                  title: COPY.composer.pinErrorTitle,
                  description: error.message || COPY.composer.pinErrorFallback,
                });
              },
            });
          }
        },
      },
    );
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    submitNote();
  }

  function confirmDelete(): void {
    if (!pendingDelete) return;
    deleteNote.mutate(pendingDelete.id, {
      onSuccess: () => { setPendingDelete(null); },
      onError: (error) => {
        setPendingDelete(null);
        showToast({
          tone: 'error',
          title: COPY.deleteDialog.errorTitle,
          description: error.message || COPY.deleteDialog.errorFallback,
        });
      },
    });
  }

  const notes = notesQuery.data ?? [];
  const isEmpty = notesQuery.isSuccess && notes.length === 0;

  const composer = canAct ? (
    <form className="order-notes__composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={composerId}>
        {COPY.composer.label}
      </label>
      <Textarea
        id={composerId}
        rows={2}
        placeholder={COPY.composer.placeholder}
        value={newBody}
        maxLength={ORDER_NOTE_MAX_LENGTH}
        disabled={write.demoReadOnly}
        onChange={(e) => { setNewBody(e.target.value); }}
      />
      <div className="order-notes__composer-foot">
        <label className="ack-row ack-row--inline">
          <input
            type="checkbox"
            checked={newShowToPacker}
            disabled={write.demoReadOnly}
            onChange={(e) => { setNewShowToPacker(e.target.checked); }}
          />
          <span>{COPY.composer.showToPacker}</span>
        </label>
        <label className="ack-row ack-row--inline">
          <input
            type="checkbox"
            checked={newPinToTop}
            disabled={write.demoReadOnly}
            onChange={(e) => { setNewPinToTop(e.target.checked); }}
          />
          <span>{COPY.composer.pinToTop}</span>
        </label>
        <span className="order-notes__counter">{COPY.composer.counter(newBody.length)}</span>
        <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
          <Button
            type="submit"
            className="button--sm"
            disabled={write.demoReadOnly || !newBody.trim() || createNote.isPending}
          >
            {COPY.composer.submit}
          </Button>
        </ReadOnlyLock>
      </div>
      {newShowToPacker ? (
        <p className="order-notes__packer-warning">{COPY.composer.packerWarning}</p>
      ) : null}
    </form>
  ) : null;

  const saveError = createNote.isError ? (
    <Alert
      tone="error"
      title={COPY.composer.saveErrorTitle}
      action={
        <Button tone="secondary" className="button--sm" onClick={submitNote}>
          {COPY.composer.retry}
        </Button>
      }
    >
      {createNote.error.message || COPY.composer.saveErrorFallback} {COPY.composer.saveErrorTail}
    </Alert>
  ) : null;

  return (
    <section
      className="detail-section order-notes-section"
      id={ORDER_NOTES_SECTION_ID}
      tabIndex={-1}
      aria-labelledby={`${composerId}-heading`}
    >
      <div className="detail-section__title-row">
        <h3 className="detail-section__title" id={`${composerId}-heading`}>
          {COPY.heading(notes.length)}
        </h3>
        <span className="detail-section__muted order-notes__privacy">
          {canAct ? COPY.privacy(channelNames) : COPY.privacyShort}
        </span>
      </div>

      {!canAct ? <p className="muted-text order-notes__read-only">{COPY.readOnly}</p> : null}

      {notesQuery.isLoading ? (
        <LoadingState liveRegion="off" title={COPY.loadingTitle} message={COPY.loadingMessage} />
      ) : null}

      {notesQuery.isError ? (
        <Alert
          tone="error"
          title={COPY.loadErrorTitle}
          action={
            <Button tone="secondary" className="button--sm" onClick={() => { void notesQuery.refetch(); }}>
              {COPY.retry}
            </Button>
          }
        >
          {COPY.loadErrorMessage}
        </Alert>
      ) : null}

      {isEmpty ? (
        <>
          <EmptyState liveRegion="off" title={COPY.emptyTitle} message={COPY.emptyMessage} />
          {composer}
          {saveError}
        </>
      ) : (
        <>
          {composer}
          {saveError}
          {notes.length > 0 ? (
            <ol className="order-notes" aria-label={COPY.listLabel}>
              {notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  internalOrderId={internalOrderId}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  canWrite={canAct}
                  onRequestDelete={setPendingDelete}
                />
              ))}
            </ol>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={COPY.deleteDialog.title}
        description={
          <>
            {COPY.deleteDialog.descriptionLead} <strong>{pendingDelete?.authorUsername}</strong>{' '}
            {COPY.deleteDialog.descriptionTail}
          </>
        }
        cancelLabel={COPY.deleteDialog.keep}
        confirmLabel={COPY.deleteDialog.confirm}
        tone="danger"
        initialFocus="cancel"
        isConfirming={deleteNote.isPending}
        onConfirm={confirmDelete}
      />
    </section>
  );
}

function PinIcon(): ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9.5 1.5 14.5 6.5 11 8 8 11l-1.5 3.5-5-5L5 8l3-3z" />
      <line x1="4" y1="12" x2="1.5" y2="14.5" />
    </svg>
  );
}

/**
 * The full-width pinned-note slot under the order header (mockup M3). Reads
 * the SAME query key as {@link OrderNotesPanel} — React Query dedupes the
 * two fetches, so mounting both costs one request, not two. Renders nothing
 * while loading or when no note is pinned; never a "no pinned note" claim.
 */
export function PinnedOrderNoteBanner({ internalOrderId }: { internalOrderId: string }): ReactElement | null {
  const notesQuery = useOrderNotesQuery(internalOrderId);
  const notes = notesQuery.data ?? [];
  const pinned = notes.find((note) => note.pinnedAt !== null);
  if (!pinned) {
    return null;
  }
  return (
    <div className="order-note-pinned" role="note" aria-label={COPY.pinned.label}>
      <span className="order-note-pinned__label">
        <PinIcon />
        {COPY.pinned.label}
      </span>
      <p className="order-note__body">{pinned.body}</p>
      <span className="order-note__head">
        <span className="order-note__author">{pinned.authorUsername}</span>
        <TimeDisplay iso={pinned.createdAt} format="relative" />
        {pinned.showToPacker ? (
          <StatusBadge tone="neutral" compact>
            {COPY.row.shownToPacker}
          </StatusBadge>
        ) : null}
        <a href={`#${ORDER_NOTES_SECTION_ID}`}>{COPY.pinned.allNotes(notes.length)}</a>
      </span>
    </div>
  );
}
