/**
 * Infakt Setup Page
 *
 * Page wrapper for the guided inFakt connection wizard.
 */
import type { ReactElement } from 'react';
import { InfaktSetupForm } from '../../features/connections/components/infakt-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function InfaktSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect inFakt"
      description="Provide your inFakt API key. OpenLinker uses it to issue invoices and read KSeF clearance status through inFakt's native e-invoicing integration."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">API key</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <InfaktSetupForm />
    </PageLayout>
  );
}
