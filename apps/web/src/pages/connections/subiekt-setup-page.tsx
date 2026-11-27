/**
 * Subiekt Setup Page
 *
 * Page wrapper for the guided Subiekt connection wizard (#1199).
 */
import type { ReactElement } from 'react';
import { SubiektSetupForm } from '../../features/connections/components/subiekt-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';
import { interpolate, useMessages } from '../../shared/i18n';
import type { SubiektProductIdentity } from '../../features/connections/components/subiekt-setup.schema';

export function SubiektSetupPage({ identity }: { identity: SubiektProductIdentity }): ReactElement {
  // Read off the identity rather than taken as a second prop: two sources for
  // one product name is two places for it to disagree, and the routes already
  // pass the identity.
  const productName = identity.productName;
  const copy = useMessages('connections');
  const page = copy.subiektSetupPage;

  return (
    <PageLayout
      eyebrow={copy.setup.eyebrow}
      title={interpolate(page.title, { product: productName })}
      description={interpolate(page.description, { product: productName })}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{page.chip}</span>
          <span className="toolbar-chip">{copy.setup.guidedSetup}</span>
        </div>
      }
    >
      <SubiektSetupForm identity={identity} />
    </PageLayout>
  );
}
