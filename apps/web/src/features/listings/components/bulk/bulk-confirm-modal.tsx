/**
 * Bulk wizard Step 5 - Submit confirmation modal
 *
 * Final guard before POST /listings/bulk-create fires. Surfaces per-variant /
 * per-product counts (#1741 AC group I), an explicit re-confirmation of
 * `publishImmediately`, and any mutation error inline.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Alert, Button } from '../../../../shared/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../shared/ui/tooltip';
import { ReadOnlyLock } from '../../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../../shared/config/demo-mode';
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
  /** Included variant count == number of offers that will be created (#1741). */
  offerCount: number;
  /** Distinct products spanned by the included variants (#1741). */
  productCount: number;
  /** Sibling variants the operator switched off; skipped in the fan-out (#1741). */
  excludedCount: number;
  /**
   * True when a multi-variant product has both publish + draft variants - the
   * listing goes live with a partial variant selector until completed (#1741).
   */
  mixedPublishWarning: boolean;
  connectionName: string;
  /** Resolved marketplace display name (#1096) - e.g. "Allegro", "Erli". */
  marketplaceName: string;
  initialPublishImmediately: boolean;
  isSubmitting: boolean;
  /**
   * Demo read-only viewer - the final "Create offers" submit renders disabled
   * with a read-only tooltip instead of hitting the backend 403 (#1704).
   */
  demoReadOnly: boolean;
  errorMessage: string | null;
  onConfirm: (publishImmediately: boolean) => void;
}

export function BulkConfirmModal({
  open,
  onOpenChange,
  offerCount,
  productCount,
  excludedCount,
  mixedPublishWarning,
  connectionName,
  marketplaceName,
  initialPublishImmediately,
  isSubmitting,
  demoReadOnly,
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
          Create {offerCount} {marketplaceName} offers on {connectionName}?
        </DialogTitle>
        <DialogDescription>
          You're about to create <strong>{offerCount} offers</strong> on{' '}
          <strong>{connectionName}</strong> ({marketplaceName}) across{' '}
          <strong>{productCount} products</strong>
          {excludedCount > 0 ? (
            <>
              , with <strong>{excludedCount}</strong> variant(s) excluded
            </>
          ) : null}
          . Each offer is a separate job; you can follow per-product progress on the
          next page.
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
              <strong>Publish immediately</strong>{' '}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="bulk-editor__infotip" role="img" aria-label="About publish immediately">
                    &#9432;
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Requests publication. The marketplace can still keep an offer as a draft if it
                  needs more or valid data on its side (common on Erli).
                </TooltipContent>
              </Tooltip>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                Uncheck to create everything as drafts.
              </small>
            </span>
          </label>

          {mixedPublishWarning ? (
            <Alert tone="warning">
              A listing has both published and draft variants, so buyers see a partial
              variant selector until the remaining variants are completed on the
              marketplace.
            </Alert>
          ) : null}

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
          <ReadOnlyLock active={demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
            <Button
              tone="primary"
              onClick={() => { onConfirm(publish); }}
              disabled={isSubmitting || demoReadOnly}
            >
              {isSubmitting ? 'Creating…' : 'Create offers'}
            </Button>
          </ReadOnlyLock>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
