/**
 * eparagony.pl Setup Page (#1911, document choice #3769)
 *
 * Page wrapper for the guided eparagony.pl connection wizard. The header chips
 * follow the operator's document choice in the form below, so the page never
 * labels itself "Fiscalization" while the operator is setting up invoices.
 */
import { useState, type ReactElement } from 'react';
import { EparagonySetupForm } from './eparagony-setup-form';
import {
  EPARAGONY_SETUP_DEFAULT_VALUES,
  type EparagonyDocumentCapability,
} from './eparagony-setup.schema';
import { PageLayout } from '../../../shared/ui/page-layout';
import { useEparagonyMessages } from '../messages';

export function EparagonySetupPage(): ReactElement {
  const copy = useEparagonyMessages().eparagonySetupPage;
  const [capabilities, setCapabilities] = useState<EparagonyDocumentCapability[]>(
    () => EPARAGONY_SETUP_DEFAULT_VALUES.enabledCapabilities ?? []
  );

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      summary={
        <div className="toolbar__group">
          {capabilities.map((capability) => (
            <span key={capability} className="toolbar-chip">
              {capability}
            </span>
          ))}
          <span className="toolbar-chip">{copy.guidedSetup}</span>
        </div>
      }
    >
      <EparagonySetupForm onDocumentCapabilitiesChange={setCapabilities} />
    </PageLayout>
  );
}
