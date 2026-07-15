/**
 * Order Invoice Panel (#757, redesign #1240 A1+A5)
 *
 * Redesigned dual-lifecycle panel for the invoicing lifecycle. States:
 *   not-issued  → Issue button + DocumentTypeSelect
 *   pending     → pulsing badge, skeleton, no action
 *   issuing     → info pulse badge, locked notice, NO action
 *   issued      → KV block + provider extras slot
 *   failed      → error inline-alert (resolveFailureCopy) + Retry (only when canRetryInvoice)
 *   in-doubt    → warning inline-alert + Check/Mark-resolved, NO Retry
 *   needs-reauth → warning alert + Re-authenticate CTA
 *   multi       → connection picker (existing logic preserved)
 *
 * Fiscal-safety rules:
 *   - NEVER render Retry for issuing/in-doubt/pending/issued
 *   - canRetryInvoice() is the single gate (failed+rejected only)
 *   - in-doubt shows "Check {provider}"/"Mark resolved" (no-op for Wave A)
 *
 * @module apps/web/src/features/invoicing/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '../../../shared/ui/dialog';

import { useConnectionsQuery, type Connection } from '../../connections';
import { useTranslation } from '../../../shared/i18n';
import { useToast } from '../../../shared/ui/toast-provider';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import { ApiError } from '../../../shared/api/api-error';
import { usePlatform } from '../../../shared/plugins';

import type { OrderRecord } from '../../orders';
import type { InvoiceRecord } from '../api/invoicing.types';
import { useOrderInvoiceQuery } from '../hooks/use-order-invoice-query';
import { useIssueInvoiceMutation } from '../hooks/use-issue-invoice-mutation';
import { resolveIssueErrorMessage } from '../lib/issue-error-message';
import { deriveInvoiceDisplayStatus, canRetryInvoice, resolveFailureCopy } from '../lib/derive-invoice-display';
import { InvoiceStatusBadge } from './invoice-status-badge';
import { RegulatoryStatusBadge } from './regulatory-status-badge';
import { DocumentTypeSelect, DOCUMENT_TYPE_LABEL_FALLBACK } from './document-type-select';
import { InvoicePdfLink } from './invoice-pdf-link';
import { TimeDisplay } from '../../../shared/ui/time-display';

const INVOICING_CAPABILITY = 'Invoicing';

interface OrderInvoicePanelProps {
  order: OrderRecord;
}

/**
 * Resolve candidate invoicing connections: active + enabled-capability,
 * sorted by id (deterministic). Returns the full match list.
 */
function selectInvoicingConnections(connections: readonly Connection[]): Connection[] {
  return connections
    .filter((c) => c.status === 'active' && c.enabledCapabilities.includes(INVOICING_CAPABILITY))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Resolve connections that need re-auth (needs_reauth or error) and have
 * Invoicing in supportedCapabilities. Shown when the active gate fails but
 * a connection is broken.
 */
function selectReauthConnections(connections: readonly Connection[]): Connection[] {
  return connections.filter(
    (c) =>
      (c.status === 'needs_reauth' || c.status === 'error') &&
      c.supportedCapabilities.includes(INVOICING_CAPABILITY),
  );
}

/**
 * Build the `KeyValueList` rows for the "issued" state — mirrors
 * `buildShipmentFieldItems` in `order-shipment-panel.tsx`. Preserves every
 * existing sub-component and i18n key verbatim; only the wrapping markup
 * changed from a bespoke `<dl>` to the shared primitive (#1449).
 */
function buildInvoiceFieldItems(
  invoice: InvoiceRecord,
  invoicingConnection: Connection | null,
  showRegulatoryBadge: boolean,
  t: (key: string, fallback: string) => string,
): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      id: 'number',
      label: t('invoice.field.number', 'Number'),
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
      label: t('invoice.field.document', 'Document'),
      value: t(
        `invoice.documentType.${invoice.documentType}`,
        DOCUMENT_TYPE_LABEL_FALLBACK[invoice.documentType] ?? invoice.documentType,
      ),
    },
  ];

  if (showRegulatoryBadge) {
    items.push({
      id: 'clearance',
      label: t('invoice.field.clearance', 'Clearance'),
      value: <RegulatoryStatusBadge status={invoice.regulatoryStatus} />,
    });
  }

  items.push(
    {
      id: 'issued',
      label: t('invoice.field.issued', 'Issued'),
      value: invoice.issuedAt ? (
        <TimeDisplay iso={invoice.issuedAt} format="datetime" className="mono-text" />
      ) : (
        <span className="text-muted">—</span>
      ),
    },
    {
      id: 'via',
      label: t('invoice.field.via', 'Invoiced via'),
      value: (
        <>
          {invoicingConnection?.name ?? invoice.connectionId}{' '}
          <span className="text-muted">· {t('invoice.field.locked', 'locked')}</span>
        </>
      ),
    },
  );

  return items;
}

export function OrderInvoicePanel({ order }: OrderInvoicePanelProps): ReactElement | null {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const connectionsQuery = useConnectionsQuery();
  const [documentType, setDocumentType] = useState<string>('invoice');
  const [pickedConnectionId, setPickedConnectionId] = useState<string | null>(null);

  const allConnections = connectionsQuery.data ?? [];

  const invoicingConnections = useMemo(
    () => selectInvoicingConnections(allConnections),
    [allConnections],
  );

  const reauthConnections = useMemo(
    () => selectReauthConnections(allConnections),
    [allConnections],
  );

  const invoicingConnection =
    invoicingConnections.length === 1
      ? invoicingConnections[0]
      : (invoicingConnections.find((c) => c.id === pickedConnectionId) ?? null);
  const invoicingConnectionId = invoicingConnection?.id ?? null;

  const invoiceQuery = useOrderInvoiceQuery(order.internalOrderId, invoicingConnectionId);
  const issueMutation = useIssueInvoiceMutation();

  // Per-provider plugin slots (resolved via platformType — ZERO literal strings here)
  const platform = usePlatform(invoicingConnection?.platformType);
  const InvoiceDetailSection = platform?.invoiceDetailSection ?? null;
  const InvoiceCorrectionFlow = platform?.invoiceCorrectionFlow ?? null;

  const [correctionOpen, setCorrectionOpen] = useState(false);

  // Loading skeleton while connections settle
  if (connectionsQuery.isLoading) {
    return (
      <section className="detail-section order-invoice-panel order-invoice-panel--loading">
        <header className="order-invoice-panel__header">
          <h3 className="detail-section__title">{t('invoice.panel.title', 'Invoice')}</h3>
        </header>
        <div className="order-invoice-panel__skeleton" aria-hidden="true" />
      </section>
    );
  }

  // needs-reauth gate: no active+enabled but a broken invoicing connection exists
  if (invoicingConnections.length === 0 && reauthConnections.length > 0) {
    const reauthConn = reauthConnections[0];
    return (
      <section className="detail-section order-invoice-panel">
        <header className="order-invoice-panel__header">
          <h3 className="detail-section__title">{t('invoice.panel.title', 'Invoice')}</h3>
          <InvoiceStatusBadge status="not-issued" />
        </header>
        <div className="order-invoice-panel__body">
          <Alert tone="warning">
            <strong>
              {t(
                'invoice.panel.reauthTitle',
                'Connection needs to reconnect.',
              )}
            </strong>{' '}
            {t(
              'invoice.panel.reauthBody',
              'Its access expired, so invoices cannot be issued until you re-authenticate this connection.',
            )}
          </Alert>
        </div>
        <div className="order-invoice-panel__actions">
          <span className="spacer" />
          <Link className="button button--primary" to={`/connections/${reauthConn.id}`}>
            {t('invoice.panel.reauth', 'Re-authenticate')}
          </Link>
        </div>
      </section>
    );
  }

  // Global capability gate: no active+enabled invoicing connection at all
  if (invoicingConnections.length === 0) {
    return null;
  }

  const requiresConnectionPick = invoicingConnections.length > 1 && !invoicingConnection;

  // Multi-connection picker
  const connectionPicker =
    invoicingConnections.length > 1 ? (
      <div className="order-invoice-panel__connection">
        <label className="order-invoice-panel__connection-label" htmlFor="invoice-connection">
          {t('invoice.panel.connectionLabel', 'Invoicing connection')}
        </label>
        <Select
          id="invoice-connection"
          value={invoicingConnectionId ?? ''}
          onChange={(event) => setPickedConnectionId(event.target.value || null)}
          aria-label={t('invoice.panel.connectionLabel', 'Invoicing connection')}
        >
          <option value="">
            {t('invoice.panel.connectionPlaceholder', 'Select a connection…')}
          </option>
          {invoicingConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
    ) : null;

  // Derive display state
  const invoice = invoiceQuery.data ?? null;
  const displayStatus = deriveInvoiceDisplayStatus(invoice);
  const showRegulatoryBadge = Boolean(invoice && invoice.regulatoryStatus !== 'not-applicable');

  const handleIssue = (): void => {
    if (!invoicingConnection) return;
    issueMutation.mutate(
      { connectionId: invoicingConnection.id, orderId: order.internalOrderId, documentType },
      {
        onSuccess: () => {
          showToast({
            tone: 'success',
            title: t('invoice.action.issued', 'Invoice issued'),
            description: t('invoice.action.issuedBody', 'The invoice was issued.'),
          });
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: t('invoice.action.issueFailed', 'Could not issue invoice'),
            description: resolveIssueErrorMessage(error, t),
          });
          if (error instanceof ApiError && error.status === 409) {
            void invoiceQuery.refetch();
          }
        },
      },
    );
  };

  return (
    <section className="detail-section order-invoice-panel">
      <header className="order-invoice-panel__header">
        <h3 className="detail-section__title">{t('invoice.panel.title', 'Invoice')}</h3>
        <div className="order-invoice-panel__header-badges">
          <InvoiceStatusBadge status={displayStatus} />
          {showRegulatoryBadge && invoice ? (
            <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
          ) : null}
        </div>
      </header>

      {connectionPicker}

      {requiresConnectionPick ? (
        <p className="order-invoice-panel__notice">
          {t(
            'invoice.panel.selectConnectionPrompt',
            'Select the invoicing connection to view or issue this order invoice.',
          )}
        </p>
      ) : null}

      {/* Invoice query error (not not-issued — must not masquerade as absent) */}
      {!requiresConnectionPick && invoiceQuery.isError ? (
        <Alert tone="error" className="order-invoice-panel__error">
          {t('invoice.query.error', 'Could not load the invoice status.')}{' '}
          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => void invoiceQuery.refetch()}
          >
            {t('invoice.query.retry', 'Retry')}
          </Button>
        </Alert>
      ) : null}

      {/* Loading skeleton */}
      {!requiresConnectionPick && !invoiceQuery.isError && invoiceQuery.isLoading ? (
        <div className="order-invoice-panel__skeleton" aria-hidden="true" />
      ) : null}

      {/* ── Issuing: locked live-lease notice, NO action ── */}
      {!requiresConnectionPick && !invoiceQuery.isError && !invoiceQuery.isLoading && displayStatus === 'issuing' ? (
        <p className="order-invoice-panel__notice order-invoice-panel__notice--locked">
          {t(
            'invoice.issuing.body',
            'An issue attempt is in progress and this invoice is locked while it runs. It finishes or releases automatically — no action needed.',
          )}
        </p>
      ) : null}

      {/* ── Pending: skeleton + notice, no action ── */}
      {!requiresConnectionPick && !invoiceQuery.isError && !invoiceQuery.isLoading && displayStatus === 'pending' ? (
        <>
          <div className="order-invoice-panel__body">
            <div className="order-invoice-panel__skeleton" style={{ width: '60%' }} aria-hidden="true" />
            <div className="order-invoice-panel__skeleton" style={{ width: '40%', marginTop: '6px' }} aria-hidden="true" />
          </div>
          <p className="order-invoice-panel__notice">
            {t(
              'invoice.pending.body',
              'Issuing in progress. This refreshes automatically when the provider responds.',
            )}
          </p>
        </>
      ) : null}

      {/* ── Issued: read-only KV + provider slot ── */}
      {!requiresConnectionPick && !invoiceQuery.isError && !invoiceQuery.isLoading && displayStatus === 'issued' && invoice ? (
        <div className="order-invoice-panel__body">
          <KeyValueList
            items={buildInvoiceFieldItems(invoice, invoicingConnection, showRegulatoryBadge, t)}
          />

          {/* Provider extras slot (e.g. KSeF UPO, Subiekt KSeF status) */}
          {InvoiceDetailSection && invoicingConnection ? (
            <InvoiceDetailSection invoice={invoice} connection={invoicingConnection} />
          ) : null}

          {/* Correction trigger — only when the provider supports the slot */}
          {InvoiceCorrectionFlow && invoicingConnection ? (
            <div className="order-invoice-panel__correction">
              <Button tone="secondary" onClick={() => setCorrectionOpen(true)}>
                {t('invoice.action.issueCorrection', 'Issue correction')}
              </Button>
              <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
                <DialogContent aria-describedby={undefined}>
                  <DialogTitle>{t('invoice.correction.dialogTitle', 'Issue correction')}</DialogTitle>
                  <InvoiceCorrectionFlow
                    invoice={invoice}
                    connection={invoicingConnection}
                    onClose={() => setCorrectionOpen(false)}
                    onCorrectionIssued={() => {
                      setCorrectionOpen(false);
                      void invoiceQuery.refetch();
                    }}
                  />
                </DialogContent>
              </Dialog>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Failed (rejected): directive error + Retry ── */}
      {!requiresConnectionPick && !invoiceQuery.isError && !invoiceQuery.isLoading && displayStatus === 'failed' && invoice ? (
        <>
          <div className="order-invoice-panel__body">
            <div className="invoice-panel__inline-alert invoice-panel__inline-alert--error">
              <span className="invoice-panel__inline-alert-bar" />
              <span>
                <strong>{resolveFailureCopy(invoice, t)}</strong>
              </span>
            </div>
          </div>
          {canRetryInvoice(invoice) ? (
            <div className="order-invoice-panel__actions">
              <span className="text-muted" style={{ fontSize: '11.5px' }}>
                {t(
                  'invoice.failed.retryHint',
                  'Rejected — nothing was issued, so it is safe to retry once the cause is fixed.',
                )}
              </span>
              <span className="spacer" />
              <Button
                tone="secondary"
                onClick={handleIssue}
                disabled={issueMutation.isPending}
              >
                {t('invoice.action.retry', 'Retry')}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ── In-doubt: warning + Check/Mark-resolved, NO Retry ── */}
      {!requiresConnectionPick && !invoiceQuery.isError && !invoiceQuery.isLoading && displayStatus === 'in-doubt' && invoice ? (
        <>
          <div className="order-invoice-panel__body">
            <div className="invoice-panel__inline-alert invoice-panel__inline-alert--warning">
              <span className="invoice-panel__inline-alert-bar" />
              <div>
                <strong>
                  {t(
                    'invoice.inDoubt.title',
                    'We could not confirm whether this invoice was issued.',
                  )}
                </strong>{' '}
                {resolveFailureCopy(invoice, t)}
              </div>
            </div>
          </div>
          <div className="order-invoice-panel__actions">
            <span className="spacer" />
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
        </>
      ) : null}

      {/* ── Not issued: DocumentTypeSelect (fills the row) + primary Issue ── */}
      {!requiresConnectionPick && !invoiceQuery.isError && !invoiceQuery.isLoading && displayStatus === 'not-issued' ? (
        <div className="order-invoice-panel__actions order-invoice-panel__actions--issue">
          <DocumentTypeSelect
            value={documentType}
            onChange={setDocumentType}
            disabled={issueMutation.isPending}
            className="order-invoice-panel__doc-type"
          />
          <Button tone="primary" onClick={handleIssue} disabled={issueMutation.isPending}>
            {t('invoice.action.issue', 'Issue invoice')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
