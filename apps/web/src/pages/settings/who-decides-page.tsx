/**
 * Who Decides What Page (#2354)
 *
 * Wave-2 product spec § 3. The single place answering "who is in charge of
 * what" across stock, orders, returns, refunds and fiscal documents.
 *
 * **Not admin-gated**, unlike `SalesDocumentsPage`: #2353 authorises the status
 * read for a read-only role precisely so it can see this, and § 2.3's
 * zero-config visibility rule means the page always renders a concrete answer
 * and a reason for every row. The write control inside `WhoDecidesPanel` is
 * what `useWriteAccess` gates.
 *
 * @module apps/web/src/pages/settings
 */
import type { ReactElement } from 'react';
import { PageLayout } from '../../shared/ui/page-layout';
import { WhoDecidesPanel, WHO_DECIDES_PAGE_COPY } from '../../features/fulfillment-authority';

export function WhoDecidesPage(): ReactElement {
  return (
    <PageLayout
      eyebrow={WHO_DECIDES_PAGE_COPY.eyebrow}
      title={WHO_DECIDES_PAGE_COPY.title}
      description={WHO_DECIDES_PAGE_COPY.lede}
      backTo={{ to: '/settings', label: WHO_DECIDES_PAGE_COPY.backLabel }}
    >
      <WhoDecidesPanel />
    </PageLayout>
  );
}
