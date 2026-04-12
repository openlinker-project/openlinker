/**
 * Advanced New Connection Page
 *
 * Escape-hatch page exposing the raw connection form (platform dropdown,
 * credentials reference, adapter key, config JSON). Used when a guided
 * wizard does not yet exist for a platform or when direct control is
 * needed.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { CreateConnectionForm } from '../../features/connections/components/create-connection-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function AdvancedNewConnectionPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Advanced connection setup"
      description="Direct form for connection fields — adapter key, credentials reference, and raw config JSON. Use the guided flows when possible."
      actions={
        <Link className="button button--secondary" to="/connections/new">
          Back
        </Link>
      }
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">Raw form</span>
          <span className="toolbar-chip">Escape hatch</span>
        </div>
      }
    >
      <CreateConnectionForm />
    </PageLayout>
  );
}
