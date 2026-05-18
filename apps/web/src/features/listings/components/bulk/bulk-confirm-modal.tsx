/**
 * Bulk wizard Step 5 — Submit confirmation modal
 *
 * Final guard before POST /listings/bulk-create fires. Surfaces aggregate
 * counts, an explicit re-confirmation of `publishImmediately`, and any
 * mutation error inline.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Alert, Button } from '../../../../shared/ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../../shared/ui/dialog';

interface BulkConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowCount: number;
  connectionName: string;
  initialPublishImmediately: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: (publishImmediately: boolean) => void;
}

export function BulkConfirmModal({
  open,
  onOpenChange,
  rowCount,
  connectionName,
  initialPublishImmediately,
  isSubmitting,
  errorMessage,
  onConfirm,
}: BulkConfirmModalProps): ReactElement {
  const [publish, setPublish] = useState(initialPublishImmediately);

  // Re-sync the local toggle when the parent's shared config changes (e.g.
  // operator went back to Step 1, flipped publishImmediately, returned).
  // Without this the modal would stay on the value it was first opened with.
  useEffect(() => {
    setPublish(initialPublishImmediately);
  }, [initialPublishImmediately]);

  return (
    <Dialog open={open} onOpenChange={isSubmitting ? undefined : onOpenChange}>
      <DialogContent>
        <DialogTitle>
          Create {rowCount} Allegro {rowCount === 1 ? 'offer' : 'offers'}?
        </DialogTitle>
        <DialogDescription>
          You're about to create {rowCount} {rowCount === 1 ? 'offer' : 'offers'} on{' '}
          <strong>{connectionName}</strong>. Each offer is a separate job; you can
          follow per-row progress on the next page.
        </DialogDescription>

        <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => { setPublish(e.target.checked); }}
              disabled={isSubmitting}
            />
            <span>
              <strong>Publish immediately</strong>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                Uncheck to create everything as drafts.
              </small>
            </span>
          </label>

          {errorMessage !== null ? (
            <Alert tone="error">{errorMessage}</Alert>
          ) : (
            <Alert tone="info">
              <strong>Idempotency protected.</strong> If you accidentally double-submit,
              OpenLinker returns the existing batch rather than creating a duplicate.
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            tone="ghost"
            onClick={() => { onOpenChange(false); }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            tone="primary"
            onClick={() => { onConfirm(publish); }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating…' : 'Create offers'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
