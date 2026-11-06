/**
 * InPost Setup Page
 *
 * Page wrapper for the guided InPost (ShipX) connection wizard.
 */
import type { ReactElement } from 'react';
import { InpostSetupForm } from '../../features/connections/components/inpost-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';
import { interpolate, useMessages } from '../../shared/i18n';
import { usePlatform } from '../../shared/plugins';

export function InpostSetupPage(): ReactElement {
  const copy = useMessages('connections');
  const page = copy.inpostSetupPage;
  const platform = usePlatform('inpost')?.displayName ?? page.fallbackPlatform;
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
      <InpostSetupForm />
    </PageLayout>
  );
}
