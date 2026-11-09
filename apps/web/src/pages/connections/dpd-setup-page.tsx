/**
 * DPD Polska Setup Page
 *
 * Page wrapper for the guided DPD Polska connection wizard.
 */
import type { ReactElement } from 'react';
import { DpdSetupForm } from '../../features/connections/components/dpd-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';
import { interpolate, useMessages } from '../../shared/i18n';
import { usePlatform } from '../../shared/plugins';

export function DpdSetupPage(): ReactElement {
  const copy = useMessages('connections');
  const page = copy.dpdSetupPage;
  const platform = usePlatform('dpd')?.displayName ?? page.fallbackPlatform;
  return (
    <PageLayout
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
