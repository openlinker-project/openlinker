/**
 * DPD Polska Setup Page
 *
 * Page wrapper for the guided DPD Polska connection wizard.
 */
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { interpolate, useMessages } from '../../shared/i18n';
import {
  OMS_SETUP_RETURN_PATH,
  isFromOmsSetup,
} from '../../features/connections/lib/oms-setup-return';
import { DpdSetupForm } from '../../features/connections/components/dpd-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';
import { usePlatform } from '../../shared/plugins';

export function DpdSetupPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const shippingCopy = useMessages('connections').shipping;
  const copy = useMessages('connections');
  const page = copy.dpdSetupPage;
  const platform = usePlatform('dpd')?.displayName ?? page.fallbackPlatform;
  return (
    <PageLayout
      backTo={
        isFromOmsSetup(searchParams)
          ? { to: OMS_SETUP_RETURN_PATH, label: shippingCopy.backToOmsSetup }
          : undefined
      }
      eyebrow={copy.setup.eyebrow}
      title={interpolate(page.title, { platform })}
      description={interpolate(page.description, { platform })}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{page.chip}</span>
          <span className="toolbar-chip">{copy.setup.guidedSetup}</span>
        </div>
      }
    >
      <DpdSetupForm />
    </PageLayout>
  );
}
