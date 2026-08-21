/**
 * Order Invoice Panel (#757, redesign #1240 A1+A5, connection lock #2047)
 *
 * Redesigned dual-lifecycle panel for the invoicing lifecycle. States:
 *   not-issued  → Issue button + DocumentTypeSelect (+ picker when >1 candidate)
 *   pending     → pulsing badge, skeleton, no action
 *   issuing     → info pulse badge, locked notice, NO action
 *   issued      → connection lock + KV block + provider extras slot
 *   failed      → error inline-alert (resolveFailureCopy) + Retry (only when canRetryInvoice)
 *   in-doubt    → warning inline-alert + Check/Mark-resolved, NO Retry
 *   needs-reauth → warning alert + Re-authenticate CTA
 *
 * CONNECTION LOCK (#2047). One sale is one invoice, so the connection is only a
 * choice while NO record exists:
 *   - a record exists  → the connection is read off `invoice.connectionId` and
 *     rendered as a read-only lock. No `Select`, so the panel can no longer be
 *     talked into reading `(order, other connection)`, seeing a 404, rendering
 *     "not issued", and offering to issue a SECOND document for one sale.
 *   - no record        → the picker earns its place. The operator-set primary
 *     (`config.invoicing.isPrimary`) is preselected; with several candidates and
 *     no primary the panel says so, because auto-issue then issues NOTHING.
 *   - `failed` + `rejected` is the ONE state where moving providers is fiscally
 *     safe (the provider created nothing), so it is offered — behind an explicit
 *     disclosure that names the consequence, never as a side effect of Retry.
 *   - the record's connection may be gone/disabled: the invoice still renders
 *     (an accounting fact) with actions disabled and NO alternative offered.
 *
 * Fiscal-safety rules:
 *   - NEVER render Retry for issuing/in-doubt/pending/issued
 *   - canRetryInvoice() is the single gate (failed+rejected only)
 *   - in-doubt shows "Check {provider}"/"Mark resolved" (no-op for Wave A)
 *
 * Write-access gating (#1613): the Issue/Retry affordances are gated behind
 * the `invoices:write` permission via `useWriteAccess`, reusing the SAME
 * visible-but-disabled-with-a-tooltip pattern as `ConnectionActionsPanel`
 * (#1615) rather than only reacting to the resulting 403 after the fact. A
 * demo read-only viewer still sees the action (disabled, `ReadOnlyLock`
 * tooltip); a genuinely unauthorized non-demo session keeps the pre-existing
 * hide-when-missing behaviour.
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
import { captureDemoEvent } from '../../demo';
import { useTranslation } from '../../../shared/i18n';
import { useToast } from '../../../shared/ui/toast-provider';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import { ApiError } from '../../../shared/api/api-error';
import { usePlatform } from '../../../shared/plugins';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';

import type { OrderRecord, ParsedOrderItem } from '../../orders';
import { parseOrderSnapshot } from '../../orders';
import type { RateLessLine } from '../lib/sales-document-block-copy';
import type { InvoiceRecord } from '../api/invoicing.types';
import { useOrderInvoiceQuery } from '../hooks/use-order-invoice-query';
import { useIssueInvoiceMutation } from '../hooks/use-issue-invoice-mutation';
import { resolveIssueErrorMessage, isMissingNumberingSeriesError } from '../lib/issue-error-message';
import { deriveInvoiceDisplayStatus, canRetryInvoice, resolveFailureCopy } from '../lib/derive-invoice-display';
import { resolveSalesDocumentBlockCopy } from '../lib/sales-document-block-copy';
import {
  isPrimaryInvoicingConnection,
  resolveIssuableConnection,
  resolveIssuingConnection,
  selectInvoicingCandidates,
  selectReauthInvoicingConnections,
} from '../lib/resolve-invoicing-connection';
import { InvoiceStatusBadge } from './invoice-status-badge';
import { InvoiceConnectionLock } from './invoice-connection-lock';
import { RegulatoryStatusBadge } from './regulatory-status-badge';
import { DocumentTypeSelect, DOCUMENT_TYPE_LABEL_FALLBACK } from './document-type-select';
import { InvoicePdfLink } from './invoice-pdf-link';
import { TimeDisplay } from '../../../shared/ui/time-display';

interface OrderInvoicePanelProps {
  order: OrderRecord;
}

/**
 * Build the `KeyValueList` rows for the "issued" state — mirrors
 * `buildShipmentFieldItems` in `order-shipment-panel.tsx`.
 *
 * The former "Invoiced via … locked" row is gone (#2047): the fact was promoted
 * into the `InvoiceConnectionLock` block above the fields. Stating it twice made
 * it read like a setting, and its "locked" claim was contradicted by the picker
 * that used to sit above it.
 */
function buildInvoiceFieldItems(
  invoice: InvoiceRecord,
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

  items.push({
    id: 'issued',
    label: t('invoice.field.issued', 'Issued'),
    value: invoice.issuedAt ? (
      <TimeDisplay iso={invoice.issuedAt} format="datetime" className="mono-text" />
    ) : (
      <span className="text-muted">—</span>
    ),
  });

  return items;
}

export function OrderInvoicePanel({ order }: OrderInvoicePanelProps): ReactElement | null {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const connectionsQuery = useConnectionsQuery();
  const [documentType, setDocumentType] = useState<string>('invoice');
  const [pickedConnectionId, setPickedConnectionId] = useState<string | null>(null);
  // Provider-switch disclosure (failed + rejected only). Holds the connection the
  // operator is about to move the order to, or `null` while the disclosure is shut.
  const [switchTargetId, setSwitchTargetId] = useState<string | null>(null);

  const allConnections = connectionsQuery.data ?? [];

  const invoicingConnections = useMemo(
    () => selectInvoicingCandidates(allConnections),
    [allConnections],
  );

  const reauthConnections = useMemo(
    () => selectReauthInvoicingConnections(allConnections),
    [allConnections],
  );

  // #2047: the read no longer needs a connection — one order has one invoice, so
  // the panel asks "is this order invoiced anywhere?" and reads the connection off
  // the answer.
  const invoiceQuery = useOrderInvoiceQuery(order.internalOrderId);
  const issueMutation = useIssueInvoiceMutation();

  const demoMode = useDemoMode();
  const write = useWriteAccess('invoices:write', demoMode);

  const invoice = invoiceQuery.data ?? null;
  const displayStatus = deriveInvoiceDisplayStatus(invoice);

  // The connection every action targets: read off the RECORD when one exists,
  // otherwise the operator's pick / the lone candidate / the configured primary.
  const lock = invoice ? resolveIssuingConnection(invoice, allConnections) : null;
  const issuableConnection = invoice
    ? null
    : resolveIssuableConnection(invoicingConnections, pickedConnectionId);
  const invoicingConnection = lock ? lock.connection : issuableConnection;

  // Per-provider plugin slots (resolved via platformType — ZERO literal strings here)
  const platform = usePlatform(invoicingConnection?.platformType);
  const InvoiceDetailSection = platform?.invoiceDetailSection ?? null;
  const InvoiceCorrectionFlow = platform?.invoiceCorrectionFlow ?? null;

  const [correctionOpen, setCorrectionOpen] = useState(false);
  // AC #6: an issue-without-a-numbering-series rejection is surfaced as an
  // actionable CTA (link to the numbering page), not a bare toast.
  const [missingNumbering, setMissingNumbering] = useState(false);

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

  // With NO record the panel is about issuing, so the capability gates apply. With
  // a record it always renders — the invoice is an accounting fact even when its
  // connection is disabled, in error, or deleted (#2047), and no gate may hide it.
  if (!invoice) {
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
  }

  // The picker is a CHOICE only for an order with no invoice and more than one
  // candidate; `requiresConnectionPick` is the "several candidates, no primary,
  // nothing picked yet" state, which is exactly when auto-issue also does nothing.
  const showConnectionPicker = !invoice && invoicingConnections.length > 1;
  const requiresConnectionPick = showConnectionPicker && issuableConnection === null;
  // Where "Set a primary" should land. NOT `/connections` (a list carrying no
  // such control) and NOT the connection DETAIL page (overview + roles only) —
  // the toggle lives on the EDIT form, so link straight there. Deterministic:
  // candidates are id-sorted.
  const setPrimaryTarget = invoicingConnections[0] ?? null;
  // #2100 — resolved once per render; `null` when nothing is blocking, or when a
  // document plausibly exists at the provider. `canRetryInvoice` IS that second
  // test (`failed` + `rejected` ⇔ the domain's `!blocksIssuanceElsewhere`), so a
  // rejected attempt still shows why auto-issue never ran, while an `in-doubt`
  // failure — which may have produced a document — suppresses. Same rule as
  // `invoiceSupersedesBlock` on the row and as the backend gate; they have to
  // agree, or the aggregate counts blocks no surface can explain.
  // #2254 — the rate-less lines, read from the order's own snapshot. The remedy
  // depends on WHY a rate is absent, and only the lines say which case this is.
  const snapshotItems = parseOrderSnapshot(order.orderSnapshot).items;
  const rateLessLines = collectRateLessLines(snapshotItems);
  const conflictLines = snapshotItems.filter((item) => Boolean(item.taxRateChannel));
  const blockCopy =
    invoice && !canRetryInvoice(invoice)
      ? null
      : resolveSalesDocumentBlockCopy(order, requiresConnectionPick, t, rateLessLines);
  // #2254 (epic F2) — the FIRST reason where the manual path must close too.
  // Every other block reason means "auto-issue did not happen" and issuing by
  // hand is a legitimate action; this one means "this cannot be issued", and the
  // backend refuses it with a 422. A live button above a red "will not be
  // issued" alert would be an invitation to a failure OL already knows about.
  const missingRateReason = order.salesDocumentBlockReason === 'missing-tax-rate';
  // #2254 — what the document's shipping line(s) will say. A mixed-rate basket
  // splits shipping proportionally, so the operator can see the shape of the
  // document before it exists; one unknown line rate makes the proportion
  // uncomputable, so the whole preview collapses to a single waiting row rather
  // than showing a split OL cannot stand behind.
  const shippingSplitPreview = renderShippingSplitPreview(
    snapshotItems,
    order.orderSnapshot,
    t,
  );
  const issueRefusal = missingRateReason
    ? rateLessLines.length === 1
      ? t('invoice.panel.issueRefusedOne', 'no tax rate on 1 line')
      : `${t('invoice.panel.issueRefusedPrefix', 'no tax rate on')} ${String(Math.max(rateLessLines.length, 1))} ${t('invoice.panel.issueRefusedSuffix', 'lines')}`
    : null;
  // "Set a primary" follows the BACKEND's reason when it has one, so the button
  // appears for the state the gate actually recorded rather than for the state the
  // browser guessed.
  const offerSetPrimary = blockCopy?.offerSetPrimary ?? false;

  const connectionPicker = showConnectionPicker ? (
    <div className="order-invoice-panel__connection">
      <label className="order-invoice-panel__connection-label" htmlFor="invoice-connection">
        {t('invoice.panel.issueOnLabel', 'Issue on')}
      </label>
      <Select
        id="invoice-connection"
        value={issuableConnection?.id ?? ''}
        onChange={(event) => setPickedConnectionId(event.target.value || null)}
        aria-label={t('invoice.panel.issueOnLabel', 'Issue on')}
      >
        <option value="">
          {t('invoice.panel.connectionPlaceholder', 'Select a connection…')}
        </option>
        {invoicingConnections.map((c) => (
          <option key={c.id} value={c.id}>
            {isPrimaryInvoicingConnection(c)
              ? `${c.name} - ${t('invoice.panel.primarySuffix', 'primary')}`
              : c.name}
          </option>
        ))}
      </Select>
    </div>
  ) : null;

  // Names for the other connections holding a record for this order (#2047).
  // Falls back to the raw id when OL no longer knows the connection — a
  // duplicate on a since-deleted provider is still a duplicate worth naming.
  const duplicateConnectionNames = (invoice?.otherInvoicingConnectionIds ?? []).map(
    (id) => allConnections.find((c) => c.id === id)?.name ?? id,
  );

  const showRegulatoryBadge = Boolean(invoice && invoice.regulatoryStatus !== 'not-applicable');
  // Connections a failed+rejected order could legitimately move to: every other
  // candidate. Never offered in any other state — see the module docstring.
  const switchCandidates =
    invoice && canRetryInvoice(invoice)
      ? invoicingConnections.filter((c) => c.id !== invoice.connectionId)
      : [];
  const switchTarget =
    switchCandidates.find((c) => c.id === switchTargetId) ?? switchCandidates[0] ?? null;

  const issueOn = (connection: Connection): void => {
    setMissingNumbering(false);
    issueMutation.mutate(
      { connectionId: connection.id, orderId: order.internalOrderId, documentType },
      {
        onSuccess: () => {
          setSwitchTargetId(null);
          showToast({
            tone: 'success',
            title: t('invoice.action.issued', 'Invoice issued'),
            description: t('invoice.action.issuedBody', 'The invoice was issued.'),
          });
        },
        onError: (error) => {
          // Missing-numbering-series surfaces as a persistent CTA below (no toast,
          // so the error isn't surfaced twice).
          if (isMissingNumberingSeriesError(error)) {
            setMissingNumbering(true);
            return;
          }
          showToast({
            tone: 'error',
            title: t('invoice.action.issueFailed', 'Could not issue invoice'),
            description: resolveIssueErrorMessage(error, t),
          });
          // A 409 means the server refused: the order is already issuing/issued
          // here, or already invoiced on ANOTHER connection (#2047). Re-read so the
          // panel shows the real record instead of the stale empty state.
          if (error instanceof ApiError && error.status === 409) {
            void invoiceQuery.refetch();
          }
        },
      },
    );
  };

  const handleIssue = (): void => {
    if (!invoicingConnection) return;
    issueOn(invoicingConnection);
  };

  const invoiceSettled = !invoiceQuery.isError && !invoiceQuery.isLoading;

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

      {/* #2100 — the explanation now comes from the BACKEND's own recorded
          decision (`order.salesDocumentBlockReason`), not from re-deriving the
          ambiguity in the browser. Re-derivation could only ever describe ONE of
          the four non-issuing exits and could disagree with what actually
          happened; the persisted reason covers `manual` and `batched` too and
          cannot contradict the gate. `blockCopy` falls back to the derived
          ambiguity message only for a row the gate has not re-evaluated since
          this shipped — the persisted value always wins when present. */}
      {blockCopy ? (
        <div className="order-invoice-panel__body">
          <Alert tone={blockCopy.tone}>
            <strong>{blockCopy.title}</strong> {blockCopy.body}
            {blockCopy.detail ? (
              <>
                {' '}
                <span className="text-muted">({blockCopy.detail})</span>
              </>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {/* #2254 (epic F6) — the return path. Every remedy in this epic leaves the
          app, is applied in a system OpenLinker does not read live, and returns
          the operator to a screen that still says the old thing. Without naming
          the latency, a correct fix looks like it did nothing and the operator
          concludes the product is broken.

          It links to the products list rather than opening a sync dialog here:
          the connection to sync is the SHOP that owns the product, which this
          panel does not know - it knows invoicing connections. A control that
          synced the wrong connection would be worse than a link to the one
          screen that does know. */}
      {missingRateReason ? (
        <div className="order-invoice-panel__body">
          <p className="order-invoice-panel__notice">
            {t(
              'invoice.panel.fixAndRecheck',
              'Rates are read during product sync, so a fix in the shop shows up on the next one.',
            )}{' '}
            <Link to="/products?taxRate=missing">
              {t('invoice.panel.fixAndRecheckAction', 'Fix and re-check')}
            </Link>
          </p>
        </div>
      ) : null}

      {/* #2254 — the conflict is INFORMATIONAL, never a block. The invoice
          exists; the two systems simply disagree about the rate, and the shop's
          won. `Alert` gives a non-error tone `role="status"`, which is the right
          politeness level for an advisory nobody has to act on immediately. */}
      {conflictLines.length > 0 ? (
        <div className="order-invoice-panel__body">
          <Alert tone="conflict">
            <strong>
              {t('invoice.panel.conflictTitle', "Invoiced on the shop's rate. The channel disagrees.")}
            </strong>{' '}
            {conflictLines
              .map(
                (line) =>
                  `${line.name ?? line.sku ?? line.id}: shop ${String(line.taxRate)}, channel ${String(line.taxRateChannel)}`,
              )
              .join('; ')}
            .
          </Alert>
        </div>
      ) : null}

      {/* #2254 — the shipping split preview lives HERE, not on the line-items
          panel, because shipping has no order line: it is composed when the
          document is. A single `waiting` row while any line rate is unknown,
          since one unknown makes the proportion uncomputable. */}
      {shippingSplitPreview}

      {/* The lock warning is about the pick, not about the primary — it must
          also show once the operator has picked on an install with NO primary,
          which is exactly the moment the "auto-issue is off" warning above
          disappears. Gating it on `hasPrimaryCandidate` used to leave that
          moment with no lock warning at all. */}
      {showConnectionPicker && !requiresConnectionPick ? (
        <p className="order-invoice-panel__notice">
          {t(
            'invoice.panel.lockWarning',
            'Not invoiced yet. The order locks to whichever connection you pick and this list disappears. Nothing is sent until you click Issue.',
          )}
        </p>
      ) : null}

      {/* Pre-existing cross-connection duplicate (#2047). The guard makes this
          unreachable for newly issued documents, but rows that predate it still
          exist and this panel now renders only the latest one — so say it out
          loud rather than letting the older document disappear from the order. */}
      {duplicateConnectionNames.length > 0 ? (
        <div className="order-invoice-panel__body">
          <Alert tone="warning">
            <strong>
              {t(
                'invoice.panel.duplicateTitle',
                'This order has documents on more than one connection.',
              )}
            </strong>{' '}
            {t(
              'invoice.panel.duplicateBody',
              'One sale should have one invoice. Below is the most recent record; another exists on',
            )}{' '}
            {duplicateConnectionNames.join(', ')}
            {'. '}
            {t(
              'invoice.panel.duplicateAdvice',
              'Check both providers and correct whichever document should not have been issued.',
            )}
          </Alert>
        </div>
      ) : null}

      {/* Invoice query error (not not-issued — must not masquerade as absent) */}
      {invoiceQuery.isError ? (
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

      {/* AC #6: no numbering series configured — actionable CTA, not a toast */}
      {missingNumbering && invoicingConnection ? (
        <Alert
          tone="warning"
          className="order-invoice-panel__error"
          title={t('invoice.numbering.missingTitle', 'Numbering not configured')}
          action={
            <Link
              className="button button--primary button--sm"
              to={`/connections/${invoicingConnection.id}/numbering`}
            >
              {t('invoice.numbering.configure', 'Configure numbering')}
            </Link>
          }
        >
          {t(
            'invoice.numbering.missingBody',
            'This connection has no invoice numbering series configured. Set one up before issuing invoices.',
          )}
        </Alert>
      ) : null}

      {/* Loading skeleton */}
      {!invoiceQuery.isError && invoiceQuery.isLoading ? (
        <div className="order-invoice-panel__skeleton" aria-hidden="true" />
      ) : null}

      {/* ── The connection lock: a fact for every state that HAS a record ── */}
      {invoiceSettled && invoice && lock ? (
        <div className="order-invoice-panel__body">
          <InvoiceConnectionLock
            status={displayStatus}
            connectionName={lock.connection?.name ?? lock.connectionId}
            tag={
              lock.isStale
                ? t('invoice.lock.tagDisconnected', 'disconnected')
                : (lock.connection?.platformType ?? '')
            }
            isStale={lock.isStale}
          />
        </div>
      ) : null}

      {/* ── Issuing: locked live-lease notice, NO action ── */}
      {invoiceSettled && displayStatus === 'issuing' ? (
        <p className="order-invoice-panel__notice order-invoice-panel__notice--locked">
          {t(
            'invoice.issuing.body',
            'An issue attempt is in progress and this invoice is locked while it runs. It finishes or releases automatically — no action needed.',
          )}
        </p>
      ) : null}

      {/* ── Pending: skeleton + notice, no action ── */}
      {invoiceSettled && displayStatus === 'pending' ? (
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
      {invoiceSettled && displayStatus === 'issued' && invoice ? (
        <div className="order-invoice-panel__body">
          <KeyValueList items={buildInvoiceFieldItems(invoice, showRegulatoryBadge, t)} />

          {/* Provider extras slot (e.g. KSeF UPO, Subiekt KSeF status) */}
          {InvoiceDetailSection && invoicingConnection ? (
            <InvoiceDetailSection invoice={invoice} connection={invoicingConnection} />
          ) : null}

          {/* Correction trigger — only when the provider supports the slot. A
              correction always goes to the ORIGINAL's connection and has no
              picker, so a stale connection disables the action rather than
              offering to correct via a different provider (that would be a
              second document referring to nothing that provider knows about). */}
          {InvoiceCorrectionFlow && invoicingConnection ? (
            <div className="order-invoice-panel__correction">
              <Button
                tone="secondary"
                onClick={() => setCorrectionOpen(true)}
                disabled={lock?.isStale ?? false}
              >
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

          {lock?.isStale ? (
            <p className="order-invoice-panel__notice">
              {t(
                'invoice.lock.reconnectHint',
                'Reconnect this connection to act on this invoice again.',
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── Failed (rejected): directive error + Retry (+ explicit provider switch) ── */}
      {invoiceSettled && displayStatus === 'failed' && invoice ? (
        <>
          <div className="order-invoice-panel__body">
            <div className="invoice-panel__inline-alert invoice-panel__inline-alert--error">
              <span className="invoice-panel__inline-alert-bar" />
              <span>
                <strong>{resolveFailureCopy(invoice, t)}</strong>
              </span>
            </div>
          </div>
          {canRetryInvoice(invoice) && write.visible ? (
            <div className="order-invoice-panel__actions">
              {/* The reassurance and the escape hatch answer different questions
                  ("is Retry safe?" vs "can I move provider?"), so they are not
                  alternatives — rendering only one meant an operator who had a
                  second connection never saw why Retry was safe at all. */}
              <span className="text-muted" style={{ fontSize: '11.5px' }}>
                {t(
                  'invoice.failed.retryHint',
                  'Rejected — nothing was issued, so it is safe to retry once the cause is fixed.',
                )}
              </span>
              {switchCandidates.length > 0 && switchTargetId === null ? (
                <Button
                  tone="secondary"
                  className="button--sm"
                  onClick={() => setSwitchTargetId(switchCandidates[0].id)}
                >
                  {t('invoice.failed.switchOpen', 'Issue on a different connection')}
                </Button>
              ) : null}
              <span className="spacer" />
              <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                <Button
                  tone="secondary"
                  onClick={handleIssue}
                  disabled={issueMutation.isPending || write.demoReadOnly || !invoicingConnection}
                >
                  {t('invoice.action.retry', 'Retry')}
                </Button>
              </ReadOnlyLock>
            </div>
          ) : null}

          {/* Provider switch: possible, but never accidental. It states the
              consequence (new numbering series + a new lock) before it acts. */}
          {canRetryInvoice(invoice) && write.visible && switchTargetId !== null && switchTarget ? (
            <div className="order-invoice-panel__body">
              <Alert tone="warning">
                <strong>
                  {t(
                    'invoice.failed.switchWarnTitle',
                    'You are moving this order to another provider.',
                  )}
                </strong>{' '}
                {t(
                  'invoice.failed.switchWarnBody',
                  'The current provider rejected it and issued nothing, so this is safe - but the order then locks to the new connection and its number comes from that provider series.',
                )}
              </Alert>
              <div className="order-invoice-panel__actions">
                <div className="order-invoice-panel__connection">
                  <label
                    className="order-invoice-panel__connection-label"
                    htmlFor="invoice-switch-connection"
                  >
                    {t('invoice.failed.switchLabel', 'Move to')}
                  </label>
                  <Select
                    id="invoice-switch-connection"
                    value={switchTarget.id}
                    onChange={(event) => setSwitchTargetId(event.target.value)}
                    aria-label={t('invoice.failed.switchLabel', 'Move to')}
                  >
                    {switchCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <span className="spacer" />
                <Button
                  tone="secondary"
                  className="button--sm"
                  onClick={() => setSwitchTargetId(null)}
                >
                  {t('invoice.failed.switchCancel', 'Cancel')}
                </Button>
                <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                  <Button
                    tone="primary"
                    className="button--sm"
                    onClick={() => issueOn(switchTarget)}
                    disabled={issueMutation.isPending || write.demoReadOnly}
                  >
                    {t('invoice.failed.switchConfirm', 'Issue here')}
                  </Button>
                </ReadOnlyLock>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ── In-doubt: warning + Check/Mark-resolved, NO Retry, NO provider switch ── */}
      {invoiceSettled && displayStatus === 'in-doubt' && invoice ? (
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
                {resolveFailureCopy(invoice, t)}{' '}
                {t(
                  'invoice.inDoubt.noSwitch',
                  'Do not move it to another provider until you know - that is how one sale ends up with two invoices.',
                )}
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
      {invoiceSettled && displayStatus === 'not-issued' && write.visible ? (
        <div className="order-invoice-panel__actions order-invoice-panel__actions--issue">
          <DocumentTypeSelect
            value={documentType}
            onChange={(next) => {
              captureDemoEvent('demo_invoice_doctype_changed', { documentType: next });
              setDocumentType(next);
            }}
            disabled={issueMutation.isPending || write.demoReadOnly}
            className="order-invoice-panel__doc-type"
          />
          {offerSetPrimary && setPrimaryTarget ? (
            <Link
              className="button button--secondary"
              to={`/connections/${setPrimaryTarget.id}/edit`}
            >
              {t('invoice.panel.setPrimary', 'Set a primary')}
            </Link>
          ) : null}
          <ReadOnlyLock
            active={write.demoReadOnly}
            message={DEMO_READ_ONLY_ACTION_MESSAGE}
            onLockedClick={() => captureDemoEvent('demo_invoice_issue_attempted', {})}
          >
            <Button
              tone="primary"
              onClick={handleIssue}
              disabled={
                issueMutation.isPending ||
                write.demoReadOnly ||
                invoicingConnection === null ||
                issueRefusal !== null
              }
            >
              {t('invoice.action.issue', 'Issue invoice')}
            </Button>
          </ReadOnlyLock>
          {/* The reason sits ON the control, not only in the alert above: a
              disabled button with no explanation beside it reads as a bug. */}
          {issueRefusal ? (
            <span className="text-muted" style={{ fontSize: '0.82rem' }}>
              {issueRefusal}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The lines with no tax rate, shaped for the remedy branches (#2254).
 *
 * "In the catalogue" is read off `productId`: a line OpenLinker resolved to an
 * internal product can be fixed in the shop that owns it, while a line that
 * resolved to none exists only as a marketplace offer - and fixing that offer
 * cannot release THIS order, because the marketplace stamped the rate at
 * purchase. Those are different instructions, so they cannot share a sentence.
 */
function collectRateLessLines(items: readonly ParsedOrderItem[]): RateLessLine[] {
  return items
    .filter((item) => !item.taxRate)
    .map((item) => ({
      name: item.name ?? item.sku ?? item.productId ?? item.id,
      inCatalogue: Boolean(item.productId),
      // The shop answered and its answer was ambiguous - distinguishable only
      // because the read WAS made, which `taxSource` records.
      ambiguousTaxClass: item.taxSource === 'shop',
    }));
}

/**
 * The shipping line(s) the document will carry (#2254).
 *
 * Rendered on the invoice panel rather than beside the order's line items,
 * because shipping has no order line: it exists only once a document is being
 * composed. One rate in the basket means one shipping line at that rate; a
 * mixed basket means several, split in proportion to line gross.
 *
 * A single unknown line rate collapses the whole thing to one `waiting` row.
 * Showing a partial split would state a proportion OpenLinker cannot compute,
 * and the document is held anyway.
 */
function renderShippingSplitPreview(
  items: readonly ParsedOrderItem[],
  snapshot: Record<string, unknown>,
  t: (key: string, fallback: string) => string,
): ReactElement | null {
  const totals = snapshot.totals as { shipping?: number; currency?: string } | undefined;
  const shipping = totals?.shipping ?? 0;
  if (!Number.isFinite(shipping) || shipping <= 0 || items.length === 0) return null;

  const anyUnknown = items.some((item) => !item.taxRate);
  if (anyUnknown) {
    return (
      <div className="order-invoice-panel__body">
        <p className="order-invoice-panel__notice">
          {t(
            'invoice.panel.shippingSplitWaiting',
            'Shipping is waiting with the document: it is split across the rates in the basket, and one line has no rate yet.',
          )}
        </p>
      </div>
    );
  }

  const grossByRate = new Map<string, number>();
  for (const item of items) {
    const rate = String(item.taxRate);
    grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + item.price * item.quantity);
  }
  if (grossByRate.size <= 1) return null;

  const totalGross = [...grossByRate.values()].reduce((sum, gross) => sum + gross, 0);
  if (totalGross <= 0) return null;

  const parts = [...grossByRate.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rate, gross]) => ({
      rate,
      amount: Math.round(((shipping * gross) / totalGross) * 100) / 100,
    }));

  return (
    <div className="order-invoice-panel__body">
      <p className="order-invoice-panel__notice">
        {t('invoice.panel.shippingSplit', 'Shipping is split across the rates in this basket:')}{' '}
        {parts.map((part) => `${part.amount.toFixed(2)} at ${part.rate}%`).join(', ')}.
      </p>
    </div>
  );
}
