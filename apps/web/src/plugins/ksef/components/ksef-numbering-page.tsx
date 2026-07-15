/**
 * KSeF numbering page (#1577)
 *
 * Dedicated numbering surface reached from the connection's Actions tab. Owns
 * the assignment / series queries and the local editing mode; renders the
 * configured cards, the not-set-up empty state, or the editor. Reached only for
 * a KSeF connection (the route is contributed by the KSeF plugin), so the
 * capability gate is the plugin boundary itself — no platformType literal here.
 *
 * @module plugins/ksef/components
 */
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import {
  useNumberingAssignmentQuery,
  useNumberingSeriesQuery,
  type NumberingSeries,
} from '../../../features/invoicing';
import { useConnectionQuery } from '../../../features/connections';
import { PageLayout } from '../../../shared/ui/page-layout';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { KsefNumberingConfigured } from './ksef-numbering-configured';
import { KsefNumberingEditor } from './ksef-numbering-editor';
import { KsefNumberingEmpty } from './ksef-numbering-empty';

type EditorMode =
  | { kind: 'view' }
  | { kind: 'setup' }
  | { kind: 'edit'; label: 'main' | 'correction'; series: NumberingSeries };

export function KsefNumberingPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const [mode, setMode] = useState<EditorMode>({ kind: 'view' });

  const connectionQuery = useConnectionQuery(connectionId);
  const assignmentQuery = useNumberingAssignmentQuery(connectionId);
  const assignment = assignmentQuery.data ?? null;

  const mainSeriesQuery = useNumberingSeriesQuery(assignment?.mainSeriesId ?? null);
  const correctionSeriesQuery = useNumberingSeriesQuery(assignment?.correctionSeriesId ?? null);

  const connectionName = connectionQuery.data?.name ?? 'connection';
  const backTo = { to: `/connections/${connectionId}?tab=actions`, label: `Actions · ${connectionName}` };

  function renderBody(): ReactElement {
    if (assignmentQuery.isLoading) {
      return <LoadingState title="Loading numbering" message="Checking this connection's numbering setup…" />;
    }
    if (assignmentQuery.error) {
      return (
        <ErrorState
          title="Unable to load numbering"
          message={assignmentQuery.error.message}
          action={
            <Button tone="secondary" onClick={() => void assignmentQuery.refetch()}>
              Retry
            </Button>
          }
        />
      );
    }

    if (mode.kind === 'setup') {
      return (
        <KsefNumberingEditor
          connectionId={connectionId}
          mode="setup"
          onDone={() => setMode({ kind: 'view' })}
          onCancel={() => setMode({ kind: 'view' })}
        />
      );
    }

    if (mode.kind === 'edit') {
      return (
        <KsefNumberingEditor
          connectionId={connectionId}
          mode="edit"
          seriesLabel={mode.label}
          series={mode.series}
          onDone={() => setMode({ kind: 'view' })}
          onCancel={() => setMode({ kind: 'view' })}
        />
      );
    }

    // Resting view.
    if (!assignment) {
      return <KsefNumberingEmpty connectionId={connectionId} onSetup={() => setMode({ kind: 'setup' })} />;
    }

    if (mainSeriesQuery.isLoading || (assignment.correctionSeriesId && correctionSeriesQuery.isLoading)) {
      return <LoadingState title="Loading series" message="Fetching the assigned numbering series…" />;
    }
    if (mainSeriesQuery.error) {
      return (
        <ErrorState
          title="Unable to load the assigned series"
          message={mainSeriesQuery.error.message}
          action={
            <Button tone="secondary" onClick={() => void mainSeriesQuery.refetch()}>
              Retry
            </Button>
          }
        />
      );
    }
    if (!mainSeriesQuery.data) {
      return (
        <EmptyState
          title="Assigned series is missing"
          message="The connection points to a series that no longer exists. Set up numbering again."
          action={
            <Button tone="primary" onClick={() => setMode({ kind: 'setup' })}>
              Set up numbering
            </Button>
          }
        />
      );
    }

    return (
      <KsefNumberingConfigured
        mainSeries={mainSeriesQuery.data}
        correctionSeries={correctionSeriesQuery.data ?? null}
        onEditMain={() =>
          setMode({ kind: 'edit', label: 'main', series: mainSeriesQuery.data as NumberingSeries })
        }
        onEditCorrection={(series) => setMode({ kind: 'edit', label: 'correction', series })}
      />
    );
  }

  return (
    <PageLayout
      backTo={backTo}
      eyebrow="Invoicing"
      title="Invoice numbering"
      description="Configure the sequential number OpenLinker stamps on every invoice cleared through this connection."
    >
      {renderBody()}
    </PageLayout>
  );
}
