/**
 * Subiekt Setup Page
 *
 * Page wrapper for the guided Subiekt connection wizard (#1199).
 */
import type { ReactElement } from 'react';
import { SubiektSetupForm } from '../../features/connections/components/subiekt-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function SubiektSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect Subiekt"
      description="Point OpenLinker at your OpenLinker Sfera bridge. OpenLinker uses it to issue invoices in Subiekt nexo for your orders."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">Sfera bridge</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <SubiektSetupForm />
    </PageLayout>
  );
}
