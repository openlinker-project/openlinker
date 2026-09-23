/**
 * Subiekt Setup Page
 *
 * Page wrapper for the guided Subiekt connection wizard (#1199).
 */
import type { ReactElement } from 'react';
import { SubiektSetupForm } from '../../features/connections/components/subiekt-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';
import type { SubiektProductIdentity } from '../../features/connections/components/subiekt-setup.schema';

export function SubiektSetupPage({ identity }: { identity: SubiektProductIdentity }): ReactElement {
  // Read off the identity rather than taken as a second prop: two sources for
  // one product name is two places for it to disagree, and the routes already
  // pass the identity.
  const productName = identity.productName;

  return (
    <PageLayout
      eyebrow="Integrations"
      title={`Connect ${productName}`}
      description={`Point OpenLinker at your ${productName} bridge. OpenLinker uses it to work with ${productName} for your orders.`}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">Sfera bridge</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <SubiektSetupForm identity={identity} />
    </PageLayout>
  );
}
