import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { AllegroSetupForm } from '../../features/allegro/components/AllegroSetupForm';
import { PageLayout } from '../../shared/ui/page-layout';

export function AllegroSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect Allegro"
      description="Authorize OpenLinker to manage your Allegro offers, orders, and inventory via the Allegro API."
      actions={
        <Link className="button button--secondary" to="/connections/new">
          Back
        </Link>
      }
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">OAuth 2.0</span>
          <span className="toolbar-chip">Allegro API</span>
        </div>
      }
    >
      <AllegroSetupForm />
    </PageLayout>
  );
}
