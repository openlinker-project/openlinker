/**
 * Shopify Setup Page
 *
 * Page wrapper for the Shopify connection form (#3974).
 */
import type { ReactElement } from 'react';
import { ShopifySetupForm } from '../../features/shopify';
import { useMessages } from '../../shared/i18n';
import { PageLayout } from '../../shared/ui/page-layout';

export function ShopifySetupPage(): ReactElement {
  const copy = useMessages('shopify').setup;
  return (
    <PageLayout eyebrow="Shopify" title={copy.title} description={copy.description}>
      <ShopifySetupForm />
    </PageLayout>
  );
}
