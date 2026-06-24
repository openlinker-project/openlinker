/**
 * Order Invoice Panel (#757)
 *
 * Order-detail panel for the invoicing lifecycle: status badge + invoice number
 * (+ scheme-guarded PDF link) + document type + regulatory (KSeF) badge +
 * status-gated Issue / Retry action and a document-type override.
 *
 * Capability-gated globally: renders only when at least one connection is
 * `status === 'active'` AND has `Invoicing` in `enabledCapabilities` (the #759
 * operator-toggle field — plan §1.5). A supported-but-disabled connection is
 * correctly NOT selected, so the Issue button is never presented for it.
 *
 * MULTIPLE INVOICING CONNECTIONS: the invoice projection is keyed by
 * (orderId, invoicingConnectionId) and the invoicing connection is NOT
 * derivable from the order's `sourceConnectionId` (verified:
 * invoicing.controller.ts getInvoiceForOrder docstring). When exactly one
 * active+enabled invoicing connection exists we bind to it (the common
 * deployment). When MORE THAN ONE exists there is no safe default: silently
 * picking one (e.g. the lowest-id) risks querying the wrong connection — the
 * panel would render "Not issued" for an order whose invoice lives on another
 * connection and a one-click Issue would create a DUPLICATE on the wrong
 * connection. So with >1 match the operator MUST explicitly pick the invoicing
 * connection before any GET/POST is wired; no action is bound to an arbitrary
 * connection.
 *
 * AC-5 DESCOPE (must be carried in the PR description, not just here): a true
 * re-issue — a NEW invoice while the original stays in Subiekt — is blocked by
 * the #1119 backend. `POST /invoices` throws `ConflictException` (HTTP 409) when
 * an invoice for the order is already `issued` (verified: invoicing.controller.ts
 * issueInvoice). With no backend path to create a second invoice, the `issued`
 * state is READ-ONLY and the re-issue button + confirmation modal are deferred
 * to a follow-up that depends on a backend change (plan §0.A/§1.1). The POST
 * action therefore covers only not-issued (no row) and failed (server
 * re-attempts) as a single Issue / Retry button.
 *
 * First order-detail panel to adopt the `t()` i18n seam (deliberate divergence
 * from `OrderShipmentPanel`'s hardcoded English — plan §1.8).
 *
 * @module apps/web/src/features/invoicing/components
 */
import { useMemo, useState, type ReactElement } from 'react';

import { useConnectionsQuery, type Connection } from '../../connections';
import { useTranslation } from '../../../shared/i18n';
import { useToast } from '../../../shared/ui/toast-provider';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { ApiError } from '../../../shared/api/api-error';

import type { OrderRecord } from '../../orders';
import { useOrderInvoiceQuery } from '../hooks/use-order-invoice-query';
import { useIssueInvoiceMutation } from '../hooks/use-issue-invoice-mutation';
import { resolveIssueErrorMessage } from '../lib/issue-error-message';
import { InvoiceStatusBadge, type InvoiceDisplayStatus } from './invoice-status-badge';
import { RegulatoryStatusBadge } from './regulatory-status-badge';
import { DocumentTypeSelect } from './document-type-select';
import { InvoicePdfLink } from './invoice-pdf-link';

const INVOICING_CAPABILITY = 'Invoicing';

/** EN fallbacks for the issued-state document-type line (PL via t()). Unknown
 *  adapter-supplied types fall back to the raw string (open-world). */
const DOCUMENT_TYPE_LABEL_FALLBACK: Record<string, string> = {
  invoice: 'Invoice (faktura)',
  receipt: 'Receipt (paragon)',
};

interface OrderInvoicePanelProps {
  order: OrderRecord;
}

/**
 * Resolve the candidate invoicing connections: active + enabled-capability
 * filter, sorted by `id` (deterministic order for the picker). Returns the full
 * match list; the panel auto-binds only when there is exactly one (plan §1.5).
 */
function selectInvoicingConnections(connections: readonly Connection[]): Connection[] {
  return connections
    .filter((c) => c.status === 'active' && c.enabledCapabilities.includes(INVOICING_CAPABILITY))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function OrderInvoicePanel({ order }: OrderInvoicePanelProps): ReactElement | null {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const connectionsQuery = useConnectionsQuery();
  const [documentType, setDocumentType] = useState<string>('invoice');
  // Optional buyer NIP for a B2B (company) invoice. Empty ⇒ B2C/retail document
  // (no tax id sent). The Order snapshot carries no scheme-tagged tax id, so the
  // operator supplies it here; presence drives the B2B/B2C axis server-side.
  const [buyerNip, setBuyerNip] = useState<string>('');
  // Operator-picked invoicing connection (only meaningful when >1 candidate).
  const [pickedConnectionId, setPickedConnectionId] = useState<string | null>(null);

  const invoicingConnections = useMemo(
    () => selectInvoicingConnections(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );

  // Bind to the connection ONLY when it is unambiguous: exactly one candidate
  // ⇒ auto-bind; more than one ⇒ require an explicit pick (no safe default —
  // the invoice key is per-connection and not derivable from the order, so a
  // silent pick risks a duplicate invoice on the wrong connection). Until the
  // operator picks, no GET/POST is wired to any connection.
  const invoicingConnection =
    invoicingConnections.length === 1
      ? invoicingConnections[0]
      : (invoicingConnections.find((c) => c.id === pickedConnectionId) ?? null);
  const invoicingConnectionId = invoicingConnection?.id ?? null;

  const invoiceQuery = useOrderInvoiceQuery(order.internalOrderId, invoicingConnectionId);
  const issueMutation = useIssueInvoiceMutation();

  // Loading skeleton while connections settle (CLS-avoidance, mirrors the
  // shipment panel).
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

  // Global capability + operator-toggle gate: no active+enabled invoicing
  // connection AT ALL ⇒ render nothing. (When candidates exist but none is
  // picked yet, `invoicingConnection` is null but we still render the picker
  // below — so gate on the candidate count, not on the resolved connection.)
  if (invoicingConnections.length === 0) {
    return null;
  }

  const requiresConnectionPick = invoicingConnections.length > 1 && !invoicingConnection;

  // Connection picker (shown whenever there is >1 candidate). Rendered as a
  // small labelled <Select>; until a pick is made the rest of the panel
  // (status/query/actions) is withheld so nothing is wired to an arbitrary
  // connection.
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

  // Derive the FE display state (plan §2.6): null → not-issued.
  const invoice = invoiceQuery.data ?? null;
  const displayStatus: InvoiceDisplayStatus = invoice ? invoice.status : 'not-issued';
  const canIssue = displayStatus === 'not-issued' || displayStatus === 'failed';
  // Regulatory (KSeF) badge gate (plan §1.6). The AC asks for a named-capability
  // check, but no regulatory-transmission-tracking capability STRING is exported
  // to the FE yet (`CORE_CAPABILITY_VALUES` has no Invoicing/KSeF entry). Interim
  // equivalent (verified backend invariant): the backend only emits a
  // non-`not-applicable` `regulatoryStatus` when the regulatory capability is
  // active + enabled for the connection, so this data gate can never surface a
  // badge for a connection where the capability is off.
  // TODO(#757): swap for `connection.enabledCapabilities.includes(<RegulatoryCapName>)`
  // once a capability string is named.
  const showRegulatoryBadge = Boolean(invoice && invoice.regulatoryStatus !== 'not-applicable');

  // Issue flow: optimistic cache-seed + invalidate is owned by the mutation's
  // onSuccess (use-issue-invoice-mutation). Here we surface the success toast and
  // reconcile the one race the backend can return: a defensive 409 (the row was
  // issued by another tab / a concurrent request) means our local view is stale,
  // so we refetch to flip the panel to `issued` instead of leaving the operator
  // on a dead Issue button.
  const handleIssue = (): void => {
    if (!invoicingConnection) {
      return;
    }
    const trimmedNip = buyerNip.trim();
    issueMutation.mutate(
      {
        connectionId: invoicingConnection.id,
        orderId: order.internalOrderId,
        documentType,
        // Presence drives B2B (company) vs B2C (private) server-side. Subiekt
        // interprets the `pl-nip` scheme as the buyer NIP.
        ...(trimmedNip.length > 0
          ? { buyerTaxId: { scheme: 'pl-nip', value: trimmedNip } }
          : {}),
      },
      {
        onSuccess: () => {
          showToast({
            tone: 'success',
            title: t('invoice.action.issued', 'Invoice issued'),
            description: t('invoice.action.issuedBody', 'The invoice was issued in Subiekt.'),
          });
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: t('invoice.action.issueFailed', 'Could not issue invoice'),
            description: resolveIssueErrorMessage(error, t),
          });
          // Defensive already-issued / in-progress race → our view is stale.
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
        <InvoiceStatusBadge status={displayStatus} />
        {showRegulatoryBadge && invoice ? (
          <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
        ) : null}
      </header>

      {connectionPicker}

      {/* >1 candidate and no pick yet ⇒ withhold status/query/actions. The
          invoice key is per-connection and not derivable from the order, so we
          must not query or wire an Issue against an arbitrary connection. */}
      {requiresConnectionPick ? (
        <p className="order-invoice-panel__notice">
          {t(
            'invoice.panel.selectConnectionPrompt',
            'Select the invoicing connection to view or issue this order’s invoice.',
          )}
        </p>
      ) : null}

      {/* Invoice-query states. A transient GET failure must NOT masquerade as
          not-issued (which would wrongly present the Issue button) — surface a
          retryable error instead. */}
      {!requiresConnectionPick && invoiceQuery.isLoading ? (
        <div className="order-invoice-panel__skeleton" aria-hidden="true" />
      ) : invoiceQuery.isError ? (
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

      {!requiresConnectionPick && !invoiceQuery.isLoading && !invoiceQuery.isError && displayStatus === 'issued' && invoice ? (
        // Read-only — no POST action (re-issue backend-blocked, plan §1.1/§0.A).
        <div className="order-invoice-panel__body">
          <InvoicePdfLink
            invoiceNumber={invoice.providerInvoiceNumber}
            pdfUrl={invoice.pdfUrl}
          />
          <p className="order-invoice-panel__doctype">
            {t('invoice.documentType.label', 'Document type')}:{' '}
            {t(
              `invoice.documentType.${invoice.documentType}`,
              DOCUMENT_TYPE_LABEL_FALLBACK[invoice.documentType] ?? invoice.documentType,
            )}
          </p>
        </div>
      ) : null}

      {/* The DTO intentionally omits `errorMessage` (PII — see invoicing.types.ts);
          issue-time failures surface the server message via toast (422/400). The
          failed branch therefore shows fixed, operator-actionable copy. */}
      {!requiresConnectionPick && !invoiceQuery.isLoading && !invoiceQuery.isError && displayStatus === 'failed' ? (
        <Alert tone="error" className="order-invoice-panel__error">
          {t('invoice.failed.body', 'Issuing this invoice failed. You can retry.')}
        </Alert>
      ) : null}

      {!requiresConnectionPick && !invoiceQuery.isLoading && !invoiceQuery.isError && canIssue ? (
        <div className="order-invoice-panel__actions">
          <DocumentTypeSelect
            value={documentType}
            onChange={setDocumentType}
            disabled={issueMutation.isPending}
          />
          <label className="order-invoice-panel__nip-label" htmlFor="invoice-buyer-nip">
            {t('invoice.buyerNip.label', 'Buyer NIP (optional, B2B)')}
          </label>
          <input
            id="invoice-buyer-nip"
            className="input"
            type="text"
            inputMode="numeric"
            value={buyerNip}
            onChange={(event) => setBuyerNip(event.target.value)}
            disabled={issueMutation.isPending}
            placeholder="np. 9521471103"
            aria-label={t('invoice.buyerNip.label', 'Buyer NIP (optional, B2B)')}
          />
          <Button tone="primary" onClick={handleIssue} disabled={issueMutation.isPending}>
            {displayStatus === 'failed'
              ? t('invoice.action.retry', 'Retry')
              : t('invoice.action.issue', 'Issue invoice')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
