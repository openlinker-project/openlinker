/**
 * Invoice Detail Page (#1240 A2)
 *
 * Full-page view for a single invoice. Accessed at `/invoices/:invoiceId`.
 * Shows the dual-lifecycle timeline, KV metadata, failure details, provider
 * extras slot, and order back-link.
 *
 * Layout: 2-column grid at ≥1024 px.
 *   LEFT:  Failure alert (when applicable) + one host card containing the
 *          Document/Regulatory KeyValueList and the nested provider region
 *          (#1462, mirrors #1449's OrderInvoicePanel card chrome)
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
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { renderRich, useMessages } from '../../shared/i18n';
import { useToast } from '../../shared/ui/toast-provider';
import { ApiError } from '../../shared/api/api-error';
import { usePlatform } from '../../shared/plugins';
import { useConnectionsQuery, type Connection } from '../../features/connections';
import { useInvoiceQuery } from '../../features/invoicing/hooks/use-invoice-query';
import { useIssueInvoiceMutation } from '../../features/invoicing/hooks/use-issue-invoice-mutation';
import {
  deriveInvoiceDisplayStatus,
  canRetryInvoice,
  resolveFailureCopy,
} from '../../features/invoicing/lib/derive-invoice-display';
import type { InvoiceRecord } from '../../features/invoicing/api/invoicing.types';
import { InvoiceStatusBadge } from '../../features/invoicing/components/invoice-status-badge';
import { RegulatoryStatusBadge } from '../../features/invoicing/components/regulatory-status-badge';
import { InvoicePdfLink } from '../../features/invoicing/components/invoice-pdf-link';
import { InvoiceTimeline } from '../../features/invoicing/components/invoice-timeline';
import { DOCUMENT_TYPE_LABEL_FALLBACK } from '../../features/invoicing/components/document-type-select';
import { resolveIssueErrorMessage } from '../../features/invoicing/lib/issue-error-message';

type InvoiceCopy = ReturnType<typeof useMessages<'invoicing'>>['invoice'];

/**
 * Build the `KeyValueList` rows for the Document fields block — same field
 * set the bespoke `<dl className="invoice-panel__kv">` rendered, only the
 * wrapping markup changed to the shared primitive (#1462, mirrors #1449's
 * `buildInvoiceFieldItems` on `OrderInvoicePanel`).
 */
function buildInvoiceDetailFieldItems(
  invoice: InvoiceRecord,
  connection: Connection | null,
  showRegulatoryBadge: boolean,
  copy: InvoiceCopy,
): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      id: 'number',
      label: copy.field.number,
      value: invoice.providerInvoiceNumber ? (
        <InvoicePdfLink
          invoiceNumber={invoice.providerInvoiceNumber}
          pdfUrl={invoice.pdfUrl}
        />
      ) : (
        <span className="text-muted">—</span>
      ),
    },
    {
      id: 'document',
      label: copy.field.document,
      value: DOCUMENT_TYPE_LABEL_FALLBACK[invoice.documentType] ?? invoice.documentType,
    },
    {
      id: 'issued',
      label: copy.field.issued,
      value: invoice.issuedAt ? (
        <TimeDisplay iso={invoice.issuedAt} format="datetime" className="mono-text" />
      ) : (
        <span className="text-muted">—</span>
      ),
    },
    {
      id: 'via',
      label: copy.field.via,
      value: connection ? (
        <Link to={`/connections/${connection.id}`} className="link">
          {connection.name}
        </Link>
      ) : (
        <span className="mono-text">{invoice.connectionId}</span>
      ),
    },
  ];

  if (showRegulatoryBadge) {
    items.push({
      id: 'clearance',
      label: copy.field.clearance,
      value: <RegulatoryStatusBadge status={invoice.regulatoryStatus} />,
    });

    if (invoice.clearanceReference) {
      items.push({
        id: 'clearanceRef',
        label: copy.field.clearanceRef,
        value: <span className="mono-text">{invoice.clearanceReference}</span>,
      });
    }
  }

  return items;
}

export function InvoiceDetailPage(): ReactElement {
  const { invoiceId = '' } = useParams<{ invoiceId: string }>();
  const copy = useMessages('invoicing').invoice;
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
            title: copy.action.issued,
            description: copy.action.issuedBody,
          });
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: copy.action.retryFailed,
            description: resolveIssueErrorMessage(error),
          });
        },
      },
    );
  }

  // ── Page states ──

  if (invoiceQuery.isLoading) {
    return (
      <PageLayout eyebrow={copy.detail.eyebrow} title={copy.detail.titleFallback}>
        <div className="invoice-detail__skeleton" aria-busy="true" aria-label={copy.detail.loading} />
      </PageLayout>
    );
  }

  if (invoiceQuery.isError) {
    const err = invoiceQuery.error;
    const isNotFound = err instanceof ApiError && err.status === 404;

    if (isNotFound) {
      return (
        <PageLayout eyebrow={copy.detail.eyebrow} title={copy.detail.notFound}>
          <EmptyState
            liveRegion="off"
            title={copy.detail.notFound}
            message={copy.detail.notFoundMessage}
          />
          <div style={{ marginTop: '16px' }}>
            <Link className="button button--secondary" to="/sales-documents">
              {copy.detail.backToList}
            </Link>
          </div>
        </PageLayout>
      );
    }

    return (
      <PageLayout eyebrow={copy.detail.eyebrow} title={copy.detail.error}>
        <ErrorState
          title={copy.detail.error}
          message={err.message}
          action={
            <Button onClick={() => void invoiceQuery.refetch()}>
              {copy.detail.retry}
            </Button>
          }
        />
      </PageLayout>
    );
  }

  if (!invoice) {
    // Should not normally reach — query.data null only before load
    return (
      <PageLayout eyebrow={copy.detail.eyebrow} title={copy.detail.titleFallback}>
        <div className="invoice-detail__skeleton" aria-busy="true" />
      </PageLayout>
    );
  }

  const showRegulatoryBadge = invoice.regulatoryStatus !== 'not-applicable';
  const title = invoice.providerInvoiceNumber ?? copy.detail.titleFallback;

  return (
    <PageLayout
      eyebrow={copy.detail.eyebrow}
      title={title}
      description={
        <span>
          {renderRich(
            copy.detail.orderLabel,
            {
              link: (chunk) => (
                <Link to={`/orders/${invoice.orderId}`} className="link mono-text">
                  {chunk}
                </Link>
              ),
            },
            { orderId: invoice.orderId },
          )}
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
              {resolveFailureCopy(invoice)}
            </Alert>
          ) : null}

          {/* Document fields + provider region — one host card (#1462) */}
          <div className="invoice-detail__card">
            <section className="detail-section">
              <h2 className="detail-section__title">
                {copy.detail.sectionDocument}
              </h2>
              <KeyValueList
                items={buildInvoiceDetailFieldItems(invoice, connection, showRegulatoryBadge, copy)}
              />
            </section>

            {/* Provider extras slot */}
            {InvoiceDetailSection && connection ? (
              <>
                <hr className="invoice-detail__card-divider" />
                <div>
                  <p className="invoice-detail__provider-label">
                    {copy.detail.providerRegion}
                  </p>
                  <InvoiceDetailSection invoice={invoice} connection={connection} />
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="invoice-detail__col invoice-detail__col--aside">
          <InvoiceTimeline invoice={invoice} />

          {/* Actions */}
          {canRetryInvoice(invoice) ? (
            <div className="invoice-detail__actions">
              <p className="text-muted" style={{ fontSize: '12px', margin: '0 0 8px' }}>
                {copy.failed.retryHint}
              </p>
              <Button
                tone="primary"
                onClick={handleRetry}
                disabled={issueMutation.isPending}
              >
                {copy.action.retry}
              </Button>
            </div>
          ) : displayStatus === 'in-doubt' ? (
            <div className="invoice-detail__actions">
              <Button
                tone="secondary"
                onClick={() => {
                  showToast({
                    tone: 'info',
                    title: copy.inDoubt.checkTitle,
                    description: copy.inDoubt.checkBody,
                  });
                }}
              >
                {copy.inDoubt.check}
              </Button>
              <Button
                tone="secondary"
                onClick={() => {
                  showToast({
                    tone: 'info',
                    title: copy.inDoubt.resolvedTitle,
                    description: copy.inDoubt.resolvedBody,
                  });
                }}
              >
                {copy.inDoubt.resolve}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </PageLayout>
  );
}
