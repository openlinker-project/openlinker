/**
 * Empik Setup Page
 *
 * Page wrapper for the guided Empik Marketplace connection wizard.
 */
import type { ReactElement } from 'react';
import { EmpikSetupForm } from '../../features/connections/components/empik-setup-form';
import { interpolate, useMessages } from '../../shared/i18n';
import { usePlatform } from '../../shared/plugins';
import { PageLayout } from '../../shared/ui/page-layout';

export function EmpikSetupPage(): ReactElement {
  const copy = useMessages('connections');
  const page = copy.empikSetupPage;
  const platform = usePlatform('empik')?.displayName ?? page.fallbackPlatform;
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
      <EmpikSetupForm />
    </PageLayout>
  );
}
