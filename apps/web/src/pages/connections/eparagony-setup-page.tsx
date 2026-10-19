/**
 * eparagony.pl Setup Page (#1911, document choice #3769)
 *
 * Page wrapper for the guided eparagony.pl connection wizard. The header chips
 * follow the operator's document choice in the form below, so the page never
 * labels itself "Fiscalization" while the operator is setting up invoices.
 */
import { useState, type ReactElement } from 'react';
import { EparagonySetupForm } from '../../features/connections/components/eparagony-setup-form';
import {
  EPARAGONY_SETUP_DEFAULT_VALUES,
  type EparagonyDocumentCapability,
} from '../../features/connections/components/eparagony-setup.schema';
import { PageLayout } from '../../shared/ui/page-layout';

export function EparagonySetupPage(): ReactElement {
  const [capabilities, setCapabilities] = useState<EparagonyDocumentCapability[]>(
    () => EPARAGONY_SETUP_DEFAULT_VALUES.enabledCapabilities ?? []
  );

  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect eparagony.pl"
      description="OpenLinker hands a sale to eparagony.pl, which issues a fiscal e-receipt on your own printer, an invoice, or both. Connecting does not issue anything by itself."
      summary={
        <div className="toolbar__group">
          {capabilities.map((capability) => (
            <span key={capability} className="toolbar-chip">
              {capability}
            </span>
          ))}
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <EparagonySetupForm onDocumentCapabilitiesChange={setCapabilities} />
    </PageLayout>
  );
}
