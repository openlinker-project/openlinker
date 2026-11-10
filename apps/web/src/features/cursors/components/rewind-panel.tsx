/**
 * RewindPanel (#4024)
 *
 * "Fetch again" for a catalogue pass or a rolling re-check. Named targets
 * only, the consequence is shown before anything is written, and a finished
 * pass is refused with the alternative (Run now). The backend re-checks every
 * one of these rules; this panel only makes them visible before the click.
 *
 * @module apps/web/src/features/cursors/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import type { CursorOverviewItem } from '../api/cursors.types';
import { useRewindCursorMutation } from '../hooks/use-rewind-cursor-mutation';
import type { SyncProgressCopy } from '../lib/sync-progress-copy';
import { describeApiError } from '../../../shared/api/describe-api-error';

interface RewindPanelProps {
  connectionId: string;
  cursor: CursorOverviewItem;
  canAct: boolean;
  copy: SyncProgressCopy;
}

export function RewindPanel({
  connectionId,
  cursor,
  canAct,
  copy,
}: RewindPanelProps): ReactElement | null {
  const [confirming, setConfirming] = useState(false);
  const mutation = useRewindCursorMutation();
  const { showToast } = useToast();
  const R = copy.rewind;
  if (!cursor.rewind) return null;

  const isPass = cursor.rewind === 'restart-pass';
  if (isPass && cursor.value === '') {
    return <p className="sync-progress__hint">{R.passFinished}</p>;
  }

  const confirm = (): void => {
    if (!cursor.rewind) return;
    mutation.mutate(
      { connectionId, cursorKey: cursor.cursorKey, target: cursor.rewind },
      {
        onSuccess: () => {
          showToast({ tone: 'success', description: R.done });
          setConfirming(false);
        },
        onError: (error) => {
          showToast({ tone: 'error', description: R.failed(describeApiError(error, 'cursors')) });
        },
      }
    );
  };

  return (
    <div className="sync-progress__rewind">
      <div className="sync-progress__choice" aria-hidden={confirming ? 'true' : undefined}>
        <span className="sync-progress__choice-title">
          {isPass ? R.restartPass : R.restartCheck}
        </span>
        <small>{isPass ? R.restartPassHint : R.restartCheckHint}</small>
      </div>
      {confirming ? (
        <div
          className="sync-progress__confirm"
          role="group"
          aria-label={isPass ? R.restartPass : R.restartCheck}
        >
          <div className="sync-progress__consequence">
            {isPass ? R.consequencePass : R.consequenceCheck}
          </div>
          <div className="sync-progress__actions">
            <Button onClick={confirm} disabled={mutation.isPending || !canAct}>
              {R.confirm}
            </Button>
            <Button
              tone="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {R.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="sync-progress__actions">
          <Button
            tone="secondary"
            disabled={!canAct}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {R.review}
          </Button>
        </div>
      )}
    </div>
  );
}
