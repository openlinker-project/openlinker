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
import { demoReadOnlyActionMessage } from '../../../../shared/config/demo-mode';
import { captureDemoEvent } from '../../../demo';
import {
  interpolate,
  renderRich,
  useFormat,
  useMessages,
  usePlural,
} from '../../../../shared/i18n';
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
  const copy = useMessages('listings').bulkConfirmModal;
  const plural = usePlural();
  const format = useFormat();
  const [publish, setPublish] = useState(initialPublishImmediately);

  // What the operator selected vs what will actually be created. The gap is the
  // thing this dialog exists to state.
  const selectedCount = offerCount + excludedCount + blockedCount + alreadyListedCount;
  const skipped = [
    blockedCount > 0 ? plural(blockedCount, copy.reasons.needsAttention) : '',
    alreadyListedCount > 0
      ? interpolate(copy.reasons.alreadyListed, {
          n: format.number(alreadyListedCount),
          connection: connectionName,
        })
      : '',
    excludedCount > 0
      ? interpolate(copy.reasons.switchedOff, { n: format.number(excludedCount) })
      : '',
  ].filter((part) => part !== '');
  const reasons = format.list(skipped);
  // Nothing would be created (#3851). Asking "List 0 of N?" and leaving the
  // button live let the operator submit an empty batch that returned them to the
  // wizard with no explanation, so the dialog states why instead and refuses.
  const nothingToCreate = offerCount === 0;

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
          {nothingToCreate
            ? interpolate(copy.title.nothingToCreate, { connection: connectionName })
            : selectedCount > offerCount
              ? interpolate(copy.title.partial, {
                  offers: format.number(offerCount),
                  selected: format.number(selectedCount),
                  connection: connectionName,
                })
              : plural(offerCount, copy.title.create, {
                  marketplace: marketplaceName,
                  connection: connectionName,
                })}
        </DialogTitle>
        {nothingToCreate ? (
          <DialogDescription>
            {skipped.length === 0
              ? copy.nothingToCreate.noneSelected
              : plural(selectedCount, copy.nothingToCreate.cannotList, { reasons })}{' '}
            {copy.nothingToCreate.goBack}
          </DialogDescription>
        ) : (
          <DialogDescription>
            {renderRich(
              copy.summary,
              { strong: (text) => <strong>{text}</strong> },
              {
                offers: plural(offerCount, copy.offerCount),
                connection: connectionName,
                marketplace: marketplaceName,
                products: plural(productCount, copy.productCount),
              },
            )}{' '}
            {/* Each reason is named separately (#2240): "excluded" is the operator's
                own choice, "blocked" is work they can still recover, and "already
                listed" is the backend skipping a duplicate. Rolling them into one
                number told the operator nothing about which one applied. */}
            {skipped.length > 0 ? (
              <>{interpolate(copy.notListed, { reasons })} </>
            ) : null}
            {copy.jobsNote}
          </DialogDescription>
        )}

        <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {nothingToCreate ? null : (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => { setPublish(e.target.checked); }}
              disabled={isSubmitting}
            />
            <span>
              <strong>{copy.publish.label}</strong>{' '}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="bulk-editor__infotip" role="img" aria-label={copy.publish.infoLabel}>
                    &#9432;
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {copy.publish.tooltip}
                </TooltipContent>
              </Tooltip>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                {copy.publish.hint}
              </small>
            </span>
          </label>
          )}

          {mixedPublishWarning ? (
            <Alert tone="warning">
              {copy.mixedPublishWarning}
            </Alert>
          ) : null}

          {errorMessage !== null ? (
            <Alert tone="error">{errorMessage}</Alert>
          ) : nothingToCreate ? null : (
            <Alert tone="info">
              {renderRich(copy.idempotency, { strong: (text) => <strong>{text}</strong> })}
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            tone="ghost"
            onClick={() => { onOpenChange(false); }}
            disabled={isSubmitting}
          >
            {copy.cancel}
          </Button>
          <ReadOnlyLock
            active={demoReadOnly}
            message={demoReadOnlyActionMessage()}
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
              disabled={isSubmitting || demoReadOnly || nothingToCreate}
            >
              {isSubmitting ? copy.submitting : copy.submit}
            </Button>
          </ReadOnlyLock>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
