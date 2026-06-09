/**
 * DPD Polska Setup Page
 *
 * Page wrapper for the guided DPD Polska connection wizard.
 */
import type { ReactElement } from 'react';
import { DpdSetupForm } from '../../features/connections/components/dpd-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function DpdSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect DPD Polska"
      description="Provide your DPDServices credentials, payer account, and sender address. OpenLinker uses them to generate courier labels and handover protocols."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">DPDServices REST</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <DpdSetupForm />
    </PageLayout>
  );
}
