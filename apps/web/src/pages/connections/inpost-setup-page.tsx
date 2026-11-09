/**
 * InPost Setup Page
 *
 * Page wrapper for the guided InPost (ShipX) connection wizard.
 */
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMessages } from '../../shared/i18n';
import {
  OMS_SETUP_RETURN_PATH,
  isFromOmsSetup,
} from '../../features/connections/lib/oms-setup-return';
import { InpostSetupForm } from '../../features/connections/components/inpost-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function InpostSetupPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const shippingCopy = useMessages('connections').shipping;
  return (
    <PageLayout
      backTo={
        isFromOmsSetup(searchParams)
          ? { to: OMS_SETUP_RETURN_PATH, label: shippingCopy.backToOmsSetup }
          : undefined
      }
      eyebrow="Integrations"
      title="Connect InPost"
      description="Provide your ShipX API token, organization id, and sender address. OpenLinker uses them to create InPost shipments and labels."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">ShipX API</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <InpostSetupForm />
    </PageLayout>
  );
}
