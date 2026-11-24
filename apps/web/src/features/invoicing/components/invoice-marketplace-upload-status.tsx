/**
 * Invoice Marketplace Upload Status (#3549)
 *
 * One row per marketplace the issued document was offered to: a badge and one
 * sentence on what it means. Below them, for an admin, ONE retry button when any
 * row can still change: the retry route re-queues the whole invoice, so a
 * button per row would offer N controls that all do the same thing and share
 * one pending state. An empty list renders nothing: no attempt was made yet, and a
 * chip claiming otherwise would be a statement about data we do not have. A
 * FAILED read is reported, never rendered as that empty state.
 *
 * The retry gate is the admin ROLE, not `invoices:write`: the route is
 * `@Roles('admin')`, and offering a button the server refuses is a promise the
 * UI cannot keep.
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useInvoiceMarketplaceUploadQuery } from '../hooks/use-invoice-marketplace-upload-query';
import { useRetryMarketplaceUploadMutation } from '../hooks/use-retry-marketplace-upload-mutation';
import { resolveMarketplaceUploadCopy } from '../lib/marketplace-upload-status';

interface InvoiceMarketplaceUploadStatusProps {
  invoiceId: string;
}

export function InvoiceMarketplaceUploadStatus({
  invoiceId,
}: InvoiceMarketplaceUploadStatusProps): ReactElement | null {
  const copy = useMessages('invoicing').invoice.marketplaceUpload;
  const isAdmin = useIsAdmin();
  const query = useInvoiceMarketplaceUploadQuery(invoiceId, true);
  const retry = useRetryMarketplaceUploadMutation();

  if (query.isError) {
    return (
      <p className="text-muted" role="status" data-testid="marketplace-upload-unreadable">
        {copy.unreadable}
      </p>
    );
  }
  const uploads = query.data?.uploads ?? [];
  if (uploads.length === 0) return null;
  const canRetry =
    isAdmin && uploads.some((entry) => resolveMarketplaceUploadCopy(entry).retryable);

  return (
    <div className="marketplace-upload" data-testid="marketplace-upload">
      {uploads.map((entry) => {
        const status = resolveMarketplaceUploadCopy(entry);
        return (
          <div key={entry.targetConnectionId} className="marketplace-upload__row">
            <StatusBadge tone={status.tone} withDot>
              {status.label}
            </StatusBadge>
            <span className="text-muted">{status.explanation}</span>
          </div>
        );
      })}
      {canRetry ? (
        <div className="marketplace-upload__row">
          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => retry.mutate(invoiceId)}
            disabled={retry.isPending}
          >
            {retry.isPending ? copy.retrying : copy.retry}
          </Button>
        </div>
      ) : null}
      {retry.isError ? (
        <p className="text-muted" role="alert">
          {copy.retryFailed}
        </p>
      ) : null}
    </div>
  );
}
