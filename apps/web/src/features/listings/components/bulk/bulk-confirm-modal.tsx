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
import { captureDemoEvent } from '../../../demo';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../../shared/ui/dialog';

/** "1 offer" / "2 offers" - the modal used to say "1 offers" (#2240). */
function countNoun(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "2 need attention and 1 switched off" - plain list, no Oxford comma. */
function joinReasons(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

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
   * Included variants that still carry a blocker (#2240). Review's Create gate
   * normally keeps this at 0, but the submit force-excludes any that get
   * through, so the modal must be able to say so - "1 of 3 variants" is the
   * whole point of a confirmation.
   */
  blockedCount: number;
  /**
   * Included, ready variants already listed on the destination (#1837/#2240).
   * They carry no blocker by design and the backend excludes them at intake, so
   * counting them as offers would promise work that will not happen.
   */
  alreadyListedCount: number;
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
  blockedCount,
  alreadyListedCount,
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

  // What the operator selected vs what will actually be created. The gap is the
  // thing this dialog exists to state.
  const selectedCount = offerCount + excludedCount + blockedCount + alreadyListedCount;
  const skipped = [
    blockedCount > 0
      ? `${blockedCount} still ${blockedCount === 1 ? 'needs' : 'need'} attention`
      : '',
    alreadyListedCount > 0 ? `${alreadyListedCount} already on ${connectionName}` : '',
    excludedCount > 0 ? `${excludedCount} switched off` : '',
  ].filter((part) => part !== '');

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
          {selectedCount > offerCount
            ? `List ${offerCount} of ${selectedCount} selected variants on ${connectionName}?`
            : `Create ${countNoun(offerCount, `${marketplaceName} offer`)} on ${connectionName}?`}
        </DialogTitle>
        <DialogDescription>
          You're about to create <strong>{countNoun(offerCount, 'offer')}</strong> on{' '}
          <strong>{connectionName}</strong> ({marketplaceName}) across{' '}
          <strong>{countNoun(productCount, 'product')}</strong>.{' '}
          {/* Each reason is named separately (#2240): "excluded" is the operator's
              own choice, "blocked" is work they can still recover, and "already
              listed" is the backend skipping a duplicate. Rolling them into one
              number told the operator nothing about which one applied. */}
          {skipped.length > 0 ? <>Not listed: {joinReasons(skipped)}. </> : null}
          Each offer is a separate job; you can follow per-product progress on the
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
          <ReadOnlyLock
            active={demoReadOnly}
            message={DEMO_READ_ONLY_ACTION_MESSAGE}
            onLockedClick={() =>
              captureDemoEvent('demo_offer_create_attempted', {
                platform: marketplaceName,
                mode: 'bulk',
              })
            }
          >
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
