/**
 * PrestaShop Setup Page
 *
 * Page wrapper for the guided PrestaShop connection wizard.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { PrestashopSetupForm } from '../../features/connections/components/prestashop-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function PrestashopSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect PrestaShop"
      description="Provide your shop URL and webservice key. OpenLinker uses them to sync products, orders, and inventory."
      actions={
        <Link className="button button--secondary" to="/connections/new">
          Back
        </Link>
      }
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">Webservice API</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <PrestashopSetupForm />
    </PageLayout>
  );
}
