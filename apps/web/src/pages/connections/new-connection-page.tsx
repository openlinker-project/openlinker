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
import { useMessages } from '../../shared/i18n';
import {
  OMS_SETUP_RETURN_PATH,
  isFromOmsSetup,
} from '../../features/connections/lib/oms-setup-return';
import { PageLayout } from '../../shared/ui/page-layout';

export function NewConnectionPage(): ReactElement {
  const copy = useMessages('connections');
  const page = copy.newConnectionPage;
  const [searchParams] = useSearchParams();
  const shippingCopy = copy.shipping;
  // The OMS setup's Shipping step sends operators here to connect a carrier;
  // the way back is to that step, not to the connections list (#3958).
  const backTo = isFromOmsSetup(searchParams)
    ? { to: OMS_SETUP_RETURN_PATH, label: shippingCopy.backToOmsSetup }
    : { to: '/connections', label: page.backLabel };
  return (
    <PageLayout
      backTo={backTo}
      eyebrow={copy.setup.eyebrow}
      title={page.title}
      description={page.description}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{copy.setup.guidedSetup}</span>
          <span className="toolbar-chip">{page.wizardsChip}</span>
        </div>
      }
    >
      <PlatformPicker />
    </PageLayout>
  );
}
