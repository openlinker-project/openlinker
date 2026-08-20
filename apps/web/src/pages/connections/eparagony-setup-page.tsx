/**
 * eparagony.pl Setup Page (#1911)
 *
 * Page wrapper for the guided eparagony.pl (Fiscalization) connection wizard.
 */
import type { ReactElement } from 'react';
import { EparagonySetupForm } from '../../features/connections/components/eparagony-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function EparagonySetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect eparagony.pl"
      description="OpenLinker hands a sale to eparagony.pl, which registers a fiscal e-receipt with your own printer. It does not issue receipts itself, and connecting does not obligate you to issue one for every sale."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">Fiscalization</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <EparagonySetupForm />
    </PageLayout>
  );
}
