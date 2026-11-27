import type { ReactElement } from 'react';
import { AllegroSetupForm } from '../../features/allegro/components/AllegroSetupForm';
import { PageLayout } from '../../shared/ui/page-layout';
import { interpolate, useMessages } from '../../shared/i18n';
import { usePlatform } from '../../shared/plugins';

export function AllegroSetupPage(): ReactElement {
  const copy = useMessages('connections');
  const page = copy.allegroSetupPage;
  const platform = usePlatform('allegro')?.displayName ?? page.fallbackPlatform;
  return (
    <PageLayout
      eyebrow={copy.setup.eyebrow}
      title={interpolate(page.title, { platform })}
      description={interpolate(page.description, { platform })}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{page.chip}</span>
          <span className="toolbar-chip">{interpolate(page.chipSecondary, { platform })}</span>
        </div>
      }
    >
      <AllegroSetupForm />
    </PageLayout>
  );
}
