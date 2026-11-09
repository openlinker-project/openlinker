/**
 * Shoper Setup Page
 *
 * Page wrapper for the guided Shoper connection wizard.
 */
import type { ReactElement } from 'react';
import { ShoperSetupForm } from '../../features/connections/components/shoper-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';
import { interpolate, useMessages } from '../../shared/i18n';
import { usePlatform } from '../../shared/plugins';

export function ShoperSetupPage(): ReactElement {
  const copy = useMessages('connections');
  const page = copy.shoperSetupPage;
  const platform = usePlatform('shoper')?.displayName ?? page.fallbackPlatform;
  return (
    <PageLayout
      eyebrow={copy.setup.eyebrow}
      title={interpolate(page.title, { platform })}
      description={page.description}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{page.chip}</span>
          <span className="toolbar-chip">{copy.setup.guidedSetup}</span>
        </div>
      }
    >
      <ShoperSetupForm />
    </PageLayout>
  );
}
