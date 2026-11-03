/**
 * Shoper Setup Page
 *
 * Page wrapper for the guided Shoper connection wizard.
 */
import type { ReactElement } from 'react';
import { ShoperSetupForm } from '../../features/connections/components/shoper-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function ShoperSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect Shoper"
      description="Provide your Shoper shop address and API token. OpenLinker uses them to connect to your shop's REST API."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">API token</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <ShoperSetupForm />
    </PageLayout>
  );
}
