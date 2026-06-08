/**
 * WooCommerce Setup Page
 *
 * Page wrapper for the guided WooCommerce connection wizard.
 */
import type { ReactElement } from 'react';
import { WoocommerceSetupForm } from '../../features/connections/components/woocommerce-setup-form';
import { PageLayout } from '../../shared/ui/page-layout';

export function WoocommerceSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect WooCommerce"
      description="Provide your store URL and REST API credentials. OpenLinker uses them to sync orders and inventory."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">REST API</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <WoocommerceSetupForm />
    </PageLayout>
  );
}
