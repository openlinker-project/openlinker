/**
 * Invoice Detail Page (#1240 A2)
 *
 * Full-page view for a single invoice. Accessed at `/invoices/:invoiceId`.
 * Shows the dual-lifecycle timeline, KV metadata, failure details, provider
 * extras slot, and order back-link.
 *
 * Layout: 2-column grid at ≥1024 px.
 *   LEFT:  Failure alert (when applicable) + Contents / Document / Regulatory KV
 *   RIGHT: InvoiceTimeline + Actions (Retry / in-doubt)
 *
 * Lifecycle states:
 *   loading      → page skeleton
 *   not-found    → EmptyState with back button
 *   error        → ErrorState with retry
 *   loaded       → full detail layout
 *
 * Fiscal-safety rules mirror the panel: Retry only for failed+rejected;
 * in-doubt shows Check/Mark-resolved buttons (Wave A = toast). Never renders
 * the Retry button for issuing/pending/in-doubt/issued.
 *
 * @module apps/web/src/pages/invoicing
 */
import type { ReactElement } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useTranslation } from '../../shared/i18n';
import { useToast } from '../../shared/ui/toast-provider';
import { ApiError } from '../../shared/api/api-error';
import { usePlatform } from '../../shared/plugins';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { useInvoiceQuery } from '../../features/invoicing/hooks/use-invoice-query';
import { useIssueInvoiceMutation } from '../../features/invoicing/hooks/use-issue-invoice-mutation';
import {
  deriveInvoiceDisplayStatus,
  canRetryInvoice,
  resolveFailureCopy,
} from '../../features/invoicing/lib/derive-invoice-display';
import { InvoiceStatusBadge } from '../../features/invoicing/components/invoice-status-badge';
import { RegulatoryStatusBadge } from '../../features/invoicing/components/regulatory-status-badge';
import { InvoicePdfLink } from '../../features/invoicing/components/invoice-pdf-link';
import { InvoiceTimeline } from '../../features/invoicing/components/invoice-timeline';
import { DOCUMENT_TYPE_LABEL_FALLBACK } from '../../features/invoicing/components/document-type-select';
import { resolveIssueErrorMessage } from '../../features/invoicing/lib/issue-error-message';

export function InvoiceDetailPage(): ReactElement {
  const { invoiceId = '' } = useParams<{ invoiceId: string }>();
  const { t } = useTranslation();
  const { showToast } = useToast();

  const invoiceQuery = useInvoiceQuery(invoiceId);
  const connectionsQuery = useConnectionsQuery();
  const issueMutation = useIssueInvoiceMutation();

  const invoice = invoiceQuery.data ?? null;
  const connections = connectionsQuery.data ?? [];

  const connection = invoice
    ? (connections.find((c) => c.id === invoice.connectionId) ?? null)
    : null;

  // Per-provider plugin slot — ZERO literal platformType strings here
  const platform = usePlatform(connection?.platformType);
  const InvoiceDetailSection = platform?.invoiceDetailSection ?? null;

  const displayStatus = invoice ? deriveInvoiceDisplayStatus(invoice) : 'not-issued';

  function handleRetry(): void {
    if (!invoice || !connection) return;
    issueMutation.mutate(
      {
        connectionId: invoice.connectionId,
        orderId: invoice.orderId,
        documentType: invoice.documentType,
      },
      {
        onSuccess: () => {
          showToast({
            tone: 'success',
            title: t('invoice.action.issued', 'Invoice issued'),
            description: t('invoice.action.issuedBody', 'The invoice was re-issued.'),
          });
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: t('invoice.action.retryFailed', 'Retry failed'),
            description: resolveIssueErrorMessage(error, t),
          });
        },
      },
    );
  }

  // ── Page states ──

  if (invoiceQuery.isLoading) {
    return (
      <PageLayout eyebrow="Operations" title={t('invoice.detail.loading', 'Invoice')}>
        <div className="invoice-detail__skeleton" aria-busy="true" aria-label={t('invoice.detail.loading', 'Loading invoice…')} />
      </PageLayout>
    );
  }

  if (invoiceQuery.isError) {
    const err = invoiceQuery.error;
    const isNotFound = err instanceof ApiError && err.status === 404;

    if (isNotFound) {
      return (
        <PageLayout eyebrow="Operations" title={t('invoice.detail.notFound', 'Invoice not found')}>
          <EmptyState
            liveRegion="off"
            title={t('invoice.detail.notFound', 'Invoice not found')}
            message={t(
              'invoice.detail.notFoundMessage',
              'This invoice does not exist or you may not have access.',
            )}
          />
          <div style={{ marginTop: '16px' }}>
            <Link className="button button--secondary" to="/invoices">
              {t('invoice.detail.backToList', 'Back to invoices')}
            </Link>
          </div>
        </PageLayout>
      );
    }

    return (
      <PageLayout eyebrow="Operations" title={t('invoice.detail.error', 'Error loading invoice')}>
        <ErrorState
          title={t('invoice.detail.error', 'Error loading invoice')}
          message={err.message}
          action={
            <Button onClick={() => void invoiceQuery.refetch()}>
              {t('invoice.detail.retry', 'Retry')}
            </Button>
          }
        />
      </PageLayout>
    );
  }

  if (!invoice) {
    // Should not normally reach — query.data null only before load
    return (
      <PageLayout eyebrow="Operations" title={t('invoice.detail.loading', 'Invoice')}>
        <div className="invoice-detail__skeleton" aria-busy="true" />
      </PageLayout>
    );
  }

  const showRegulatoryBadge = invoice.regulatoryStatus !== 'not-applicable';
  const title = invoice.providerInvoiceNumber ?? t('invoice.detail.titleFallback', 'Invoice');

  return (
    <PageLayout
      eyebrow="Operations"
      title={title}
      backTo={{ to: '/invoices', label: t('invoice.detail.backToList', 'Back to invoices') }}
      description={
        <span>
          {t('invoice.detail.orderLabel', 'Order')}{' '}
          <Link to={`/orders/${invoice.orderId}`} className="link mono-text">
            {invoice.orderId}
          </Link>
        </span>
      }
      actions={
        <div className="invoice-detail__head-badges">
          <InvoiceStatusBadge status={displayStatus} />
          {showRegulatoryBadge ? (
            <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
          ) : null}
        </div>
      }
    >
      <div className="invoice-detail__grid">
        {/* ── LEFT COLUMN ── */}
        <div className="invoice-detail__col invoice-detail__col--main">

          {/* Failure / in-doubt alert */}
          {(displayStatus === 'failed' || displayStatus === 'in-doubt') ? (
            <Alert tone={displayStatus === 'failed' ? 'error' : 'warning'} className="invoice-detail__alert">
              {resolveFailureCopy(invoice, t)}
            </Alert>
          ) : null}

          {/* Invoice KV */}
          <section className="detail-section">
            <h2 className="detail-section__title">
              {t('invoice.detail.sectionDocument', 'Document')}
            </h2>
            <dl className="invoice-panel__kv">
              <dt>{t('invoice.field.number', 'Number')}</dt>
              <dd>
                {invoice.providerInvoiceNumber ? (
                  <InvoicePdfLink
                    invoiceNumber={invoice.providerInvoiceNumber}
                    pdfUrl={invoice.pdfUrl}
                  />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>

              <dt>{t('invoice.field.document', 'Document type')}</dt>
              <dd>
                {t(
                  `invoice.documentType.${invoice.documentType}`,
                  DOCUMENT_TYPE_LABEL_FALLBACK[invoice.documentType] ?? invoice.documentType,
                )}
              </dd>

              <dt>{t('invoice.field.issued', 'Issued at')}</dt>
              <dd>
                {invoice.issuedAt ? (
                  <TimeDisplay iso={invoice.issuedAt} format="datetime" className="mono-text" />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>

              <dt>{t('invoice.field.via', 'Invoiced via')}</dt>
              <dd>
                {connection ? (
                  <Link to={`/connections/${connection.id}`} className="link">
                    {connection.name}
                  </Link>
                ) : (
                  <span className="mono-text">{invoice.connectionId}</span>
                )}
              </dd>

              {showRegulatoryBadge ? (
                <>
                  <dt>{t('invoice.field.clearance', 'Regulatory clearance')}</dt>
                  <dd>
                    <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
                  </dd>
                  {invoice.clearanceReference ? (
                    <>
                      <dt>{t('invoice.field.clearanceRef', 'Reference')}</dt>
                      <dd className="mono-text">{invoice.clearanceReference}</dd>
                    </>
                  ) : null}
                </>
              ) : null}
            </dl>
          </section>

          {/* Provider extras slot */}
          {InvoiceDetailSection && connection ? (
            <InvoiceDetailSection invoice={invoice} connection={connection} />
          ) : null}
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="invoice-detail__col invoice-detail__col--aside">
          <InvoiceTimeline invoice={invoice} />

          {/* Actions */}
          {canRetryInvoice(invoice) ? (
            <div className="invoice-detail__actions">
              <p className="text-muted" style={{ fontSize: '12px', margin: '0 0 8px' }}>
                {t(
                  'invoice.failed.retryHint',
                  'Rejected — nothing was issued, safe to retry once the cause is fixed.',
                )}
              </p>
              <Button
                tone="primary"
                onClick={handleRetry}
                disabled={issueMutation.isPending}
              >
                {t('invoice.action.retry', 'Retry')}
              </Button>
            </div>
          ) : displayStatus === 'in-doubt' ? (
            <div className="invoice-detail__actions">
              <Button
                tone="secondary"
                onClick={() => {
                  showToast({
                    tone: 'info',
                    title: t('invoice.inDoubt.checkTitle', 'Check provider'),
                    description: t(
                      'invoice.inDoubt.checkBody',
                      'Open the provider portal and verify whether an invoice exists for this order.',
                    ),
                  });
                }}
              >
                {t('invoice.inDoubt.check', 'Check provider')}
              </Button>
              <Button
                tone="secondary"
                onClick={() => {
                  showToast({
                    tone: 'info',
                    title: t('invoice.inDoubt.resolvedTitle', 'Marked resolved'),
                    description: t(
                      'invoice.inDoubt.resolvedBody',
                      'Mark-resolved is a Wave B feature — no backend endpoint yet.',
                    ),
                  });
                }}
              >
                {t('invoice.inDoubt.resolve', 'Mark resolved')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </PageLayout>
  );
}
