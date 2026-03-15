import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ConnectionsOverview } from '../../features/connections/components/connections-overview';
import { PageLayout } from '../../shared/ui/page-layout';

export function ConnectionsListPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Integration control center"
      description="Review connection health, diagnose sync readiness, and manage channel configuration from one workspace."
      actions={
        <Link className="button" to="/connections/new">
          New connection
        </Link>
      }
      summary={
        <>
          <div className="toolbar__group">
            <span className="toolbar-chip">Status first</span>
            <span className="toolbar-chip">Debuggable</span>
            <span className="toolbar-chip">Operator workflow</span>
          </div>
          <div className="toolbar__group">
            <span className="muted-text">List to detail pattern</span>
          </div>
        </>
      }
    >
      <ConnectionsOverview />
    </PageLayout>
  );
}
