/**
 * KSeF Setup Page
 *
 * Page wrapper for the guided KSeF (Polish national e-invoicing) connection
 * wizard.
 */
import type { ReactElement } from 'react';
import { KsefSetupForm } from '../../features/connections/components/ksef-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function KsefSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect KSeF"
      description="Provide your KSeF environment, seller context, and authentication secret. OpenLinker uses them to clear invoices through the Polish national e-invoicing system."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">e-Invoicing</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <KsefSetupForm />
    </PageLayout>
  );
}
