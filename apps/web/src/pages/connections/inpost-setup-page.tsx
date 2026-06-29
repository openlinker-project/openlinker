/**
 * InPost Setup Page
 *
 * Page wrapper for the guided InPost (ShipX) connection wizard.
 */
import type { ReactElement } from 'react';
import { InpostSetupForm } from '../../features/connections/components/inpost-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function InpostSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect InPost"
      description="Provide your ShipX API token, organization id, and sender address. OpenLinker uses them to create InPost shipments and labels."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">ShipX API</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <InpostSetupForm />
    </PageLayout>
  );
}
