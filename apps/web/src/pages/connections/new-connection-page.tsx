/**
 * New Connection Page
 *
 * Step 1 of the connection setup flow: platform picker. Each platform
 * links to its own guided wizard at `/connections/new/{platform}`; an
 * advanced escape-hatch route is also exposed.
 */
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlatformPicker } from '../../features/connections/components/platform-picker';
import { CONNECTION_SHIPPING_COPY } from '../../features/connections/lib/connection-shipping.copy';
import {
  OMS_SETUP_RETURN_PATH,
  isFromOmsSetup,
} from '../../features/connections/lib/oms-setup-return';
import { PageLayout } from '../../shared/ui/page-layout';

export function NewConnectionPage(): ReactElement {
  const [searchParams] = useSearchParams();
  // The OMS setup's Shipping step sends operators here to connect a carrier;
  // the way back is to that step, not to the connections list (#3958).
  const backTo = isFromOmsSetup(searchParams)
    ? { to: OMS_SETUP_RETURN_PATH, label: CONNECTION_SHIPPING_COPY.backToOmsSetup }
    : { to: '/connections', label: 'Connections' };
  return (
    <PageLayout
      backTo={backTo}
      eyebrow="Integrations"
      title="Add a connection"
      description="Pick the platform you want to connect. Each platform has a guided setup flow — no raw adapter keys or config JSON required."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">Guided setup</span>
          <span className="toolbar-chip">Per-platform wizards</span>
        </div>
      }
    >
      <PlatformPicker />
    </PageLayout>
  );
}
