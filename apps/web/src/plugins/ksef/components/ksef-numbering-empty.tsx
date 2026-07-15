/**
 * KSeF numbering — not-set-up (empty) view (#1577)
 *
 * Shown when the connection has no numbering assignment. Offers the primary
 * "Set up numbering" action and, below it, the list of unassigned (orphaned)
 * series — series survive connection deletion (C1 guarantee), so an operator
 * can re-attach an existing one instead of authoring a new series. Each row
 * shows the pattern, its last-issued number, its reset policy, and a Re-attach
 * button (C2 orphaned-series endpoint).
 *
 * @module plugins/ksef/components
 */
import { useRef, type ReactElement } from 'react';
import {
  useSetNumberingAssignmentMutation,
  useUnassignedNumberingSeriesQuery,
} from '../../../features/invoicing';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { useToast } from '../../../shared/ui/toast-provider';
import { RESET_POLICY_LABELS } from './ksef-numbering.schema';

interface KsefNumberingEmptyProps {
  connectionId: string;
  onSetup: () => void;
}

export function KsefNumberingEmpty({ connectionId, onSetup }: KsefNumberingEmptyProps): ReactElement {
  const unassignedQuery = useUnassignedNumberingSeriesQuery();
  const reattach = useSetNumberingAssignmentMutation();
  const { showToast } = useToast();
  const listRef = useRef<HTMLDivElement | null>(null);

  const unassigned = unassignedQuery.data ?? [];

  async function handleReattach(seriesId: string): Promise<void> {
    try {
      await reattach.mutateAsync({ connectionId, input: { mainSeriesId: seriesId } });
      showToast({
        tone: 'success',
        title: 'Series re-attached',
        description: 'This connection now uses the selected series.',
      });
    } catch (error) {
      showToast({ tone: 'error', title: 'Could not re-attach series', description: (error as Error).message });
    }
  }

  return (
    <div className="numbering-empty">
      <EmptyState
        title="No numbering series yet"
        message="Set up a series before issuing invoices — KSeF needs a unique, sequential number for every document."
        action={
          <div className="numbering-empty__cta">
            <Button tone="primary" onClick={onSetup}>
              Set up numbering
            </Button>
            {unassigned.length > 0 ? (
              <Button
                tone="secondary"
                onClick={() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                Re-attach an existing series
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="numbering-empty__unassigned" ref={listRef}>
        {unassignedQuery.isLoading ? (
          <LoadingState title="Loading series" message="Fetching unassigned numbering series…" />
        ) : unassignedQuery.error ? (
          <ErrorState
            title="Unable to load unassigned series"
            message={unassignedQuery.error.message}
            action={
              <Button tone="secondary" onClick={() => void unassignedQuery.refetch()}>
                Retry
              </Button>
            }
          />
        ) : unassigned.length === 0 ? null : (
          <>
            <h3 className="section-title">Unassigned series</h3>
            {reattach.error ? (
              <Alert tone="error" title="Could not re-attach series">
                {reattach.error.message}
              </Alert>
            ) : null}
            <ul className="numbering-unassigned-list">
              {unassigned.map((series) => (
                <li key={series.id} className="numbering-unassigned-list__item">
                  <div className="numbering-unassigned-list__info">
                    <span className="numbering-unassigned-list__pattern mono-text">{series.pattern}</span>
                    <span className="muted-text">
                      Last issued:{' '}
                      <span className="mono-text tabular">
                        {series.lastIssuedNumberPreview ?? 'none yet'}
                      </span>{' '}
                      · Resets {RESET_POLICY_LABELS[series.resetPolicy].toLowerCase()}
                    </span>
                  </div>
                  <Button
                    tone="secondary"
                    disabled={reattach.isPending}
                    onClick={() => void handleReattach(series.id)}
                  >
                    Re-attach
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
