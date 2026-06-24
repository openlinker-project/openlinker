/**
 * Erli Setup Page
 *
 * Page wrapper for the guided Erli connection wizard.
 */
import type { ReactElement } from 'react';
import { ErliSetupForm } from '../../features/connections/components/erli-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function ErliSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect Erli"
      description="Provide your Erli Shop API key. OpenLinker uses it to sync offers and orders with your Erli seller account."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">API key</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <ErliSetupForm />
    </PageLayout>
  );
}
