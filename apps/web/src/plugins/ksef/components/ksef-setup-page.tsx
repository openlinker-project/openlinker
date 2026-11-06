/**
 * KSeF Setup Page
 *
 * Plugin-owned page wrapper for the guided KSeF (Polish national e-invoicing) connection
 * wizard.
 */
import type { ReactElement } from 'react';
import { KsefSetupForm } from './ksef-setup-form';
import { PageLayout } from '../../../shared/ui/page-layout';
import { useKsefMessages } from '../messages';

export function KsefSetupPage(): ReactElement {
  const copy = useKsefMessages().ksefSetupPage;
  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{copy.chips.eInvoicing}</span>
          <span className="toolbar-chip">{copy.chips.guided}</span>
        </div>
      }
    >
      <KsefSetupForm />
    </PageLayout>
  );
}
