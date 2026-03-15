import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { CreateConnectionForm } from '../../features/connections/components/create-connection-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function NewConnectionPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="New integration setup"
      description="Setup flows should be structured, explicit, and ready to evolve into step-based onboarding."
      actions={
        <Link className="button button--secondary" to="/connections">
          Back to integrations
        </Link>
      }
      summary={
        <>
          <div className="toolbar__group">
            <span className="toolbar-chip">Setup pattern</span>
            <span className="toolbar-chip">Validated form</span>
          </div>
          <div className="toolbar__group">
            <span className="muted-text">Draft to validate to activate</span>
          </div>
        </>
      }
    >
      <CreateConnectionForm />
    </PageLayout>
  );
}
