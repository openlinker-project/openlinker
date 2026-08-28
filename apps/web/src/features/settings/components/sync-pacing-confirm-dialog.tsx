/**
 * Sync Pacing Confirm Dialog
 *
 * The confirmation before a save, built from the diff and nothing else. It
 * lists only what actually moved, each with its own consequence, so it reads
 * differently every time and cannot be clicked through by reflex.
 *
 * It renders nothing when nothing changed. That is not an edge case being
 * tolerated — a modal that appears for a no-op is the thing that teaches an
 * operator to dismiss it unread.
 *
 * @module apps/web/src/features/settings/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import type { SyncPacingDiff } from '../lib/sync-pacing-changes';

interface SyncPacingConfirmDialogProps {
  open: boolean;
  diff: SyncPacingDiff;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SyncPacingConfirmDialog({
  open,
  diff,
  saving,
  onCancel,
  onConfirm,
}: SyncPacingConfirmDialogProps): ReactElement | null {
  if (diff.changes.length === 0) {
    return null;
  }

  const count = diff.changes.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>Save these changes?</DialogTitle>
        <DialogDescription>
          {count === 1 ? 'One setting changed' : `${String(count)} settings changed`}. Everything
          else stays as it is.
        </DialogDescription>

        <div className="dialog__body">
          <div className="change-list">
            {diff.changes.map((change) => (
              <div className="change" key={change.field}>
                <div className="change__head">
                  <span className="change__name">{change.label}</span>
                  <span className="change__delta">
                    {change.fromLabel} <span aria-hidden="true">&rarr;</span>{' '}
                    <b>{change.toLabel}</b>
                  </span>
                </div>
                <p className="change__effect">{change.effect}</p>
                {change.timing !== undefined ? (
                  <p className="change__timing">{change.timing}</p>
                ) : null}
              </div>
            ))}
          </div>

          {diff.lengthensDeletionWindow ? (
            <Alert tone="warning" title="One change makes things worse">
              A product deleted in your shop will now keep selling on your marketplaces for longer
              than it does today. Nothing else in OpenLinker catches it.
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button tone="secondary" onClick={onCancel} disabled={saving}>
            Keep editing
          </Button>
          <Button onClick={onConfirm} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
