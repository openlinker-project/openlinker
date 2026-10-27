/**
 * Invoice Marketplace Upload Status (#3549)
 *
 * One row per marketplace the issued document was offered to: a badge, one
 * sentence on what it means, and - for an admin, when another attempt can help -
 * a retry button. An empty list renders nothing: no attempt was made yet, and a
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
import { useTranslation } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useInvoiceMarketplaceUploadQuery } from '../hooks/use-invoice-marketplace-upload-query';
import { useRetryMarketplaceUploadMutation } from '../hooks/use-retry-marketplace-upload-mutation';
import { resolveMarketplaceUploadCopy } from '../lib/marketplace-upload-copy';

interface InvoiceMarketplaceUploadStatusProps {
  invoiceId: string;
}

export function InvoiceMarketplaceUploadStatus({
  invoiceId,
}: InvoiceMarketplaceUploadStatusProps): ReactElement | null {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const query = useInvoiceMarketplaceUploadQuery(invoiceId, true);
  const retry = useRetryMarketplaceUploadMutation();

  if (query.isError) {
    return (
      <p className="text-muted" role="status" data-testid="marketplace-upload-unreadable">
        {t(
          'invoice.marketplaceUpload.unreadable',
          'Could not read whether the document reached the marketplace.',
        )}
      </p>
    );
  }
  const uploads = query.data?.uploads ?? [];
  if (uploads.length === 0) return null;

  return (
    <div className="marketplace-upload" data-testid="marketplace-upload">
      {uploads.map((entry) => {
        const copy = resolveMarketplaceUploadCopy(entry);
        return (
          <div key={entry.targetConnectionId} className="marketplace-upload__row">
            <StatusBadge tone={copy.tone} withDot>
              {t(`invoice.marketplaceUpload.status.${entry.status}`, copy.label)}
            </StatusBadge>
            <span className="text-muted">{copy.explanation}</span>
            {copy.retryable && isAdmin ? (
              <Button
                tone="secondary"
                className="button--sm"
                onClick={() => retry.mutate(invoiceId)}
                disabled={retry.isPending}
              >
                {retry.isPending
                  ? t('invoice.marketplaceUpload.retrying', 'Queuing…')
                  : t('invoice.marketplaceUpload.retry', 'Try again')}
              </Button>
            ) : null}
          </div>
        );
      })}
      {retry.isError ? (
        <p className="text-muted" role="alert">
          {t('invoice.marketplaceUpload.retryFailed', 'Could not queue another attempt.')}
        </p>
      ) : null}
    </div>
  );
}
