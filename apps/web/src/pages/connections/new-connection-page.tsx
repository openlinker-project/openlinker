/**
 * New Connection Page
 *
 * Step 1 of the connection setup flow: platform picker. Each platform
 * links to its own guided wizard at `/connections/new/{platform}`; an
 * advanced escape-hatch route is also exposed.
 */
import type { ReactElement } from 'react';
import { PlatformPicker } from '../../features/connections/components/platform-picker';
import { PageLayout } from '../../shared/ui/page-layout';
import { useMessages } from '../../shared/i18n';

export function NewConnectionPage(): ReactElement {
  const copy = useMessages('connections');
  const page = copy.newConnectionPage;
  return (
    <PageLayout
      backTo={{ to: '/connections', label: page.backLabel }}
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
