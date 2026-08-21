/**
 * Sales Document Panel (#2160, ADR-041 §3a/3b)
 *
 * Unifies `OrderInvoicePanel` (invoicing) and `OrderReceiptPanel` (fiscalization)
 * into ONE "Sales document" slot on the order detail page, per the epic #2154
 * mockup (tabs 01 "Before/after" and 03 "Order"): an order gets at most one
 * *originating* sales document — invoice OR fiscal receipt, never both — so the
 * two independent, uncoordinated panels the pre-#2160 page rendered are
 * replaced with one panel that reads whichever document (if any) the order
 * actually carries and renders exactly one `.doc-slot`.
 *
 * This is a MERGE of the two panels' presentation, not a rewrite of either
 * one's underlying data/mutation logic: every query hook, mutation hook, pure
 * derivation helper, and status/KV/artefact display component below is the
 * SAME one `OrderInvoicePanel` / `OrderReceiptPanel` used, now re-exported from
 * their feature barrels for this cross-feature consumer (see the barrel
 * docstrings). `OrderInvoicePanel` and `OrderReceiptPanel` themselves were
 * deleted — nothing else rendered them (verified: both were comment-only
 * references elsewhere).
 *
 * Composes across TWO features (`invoicing` + `fiscalization`), so it lives in
 * `orders` — the feature that already owns `order-detail-page.tsx` and has no
 * counterpart context of its own to prefer over the other two (matching the
 * issue's own "likely a new small feature or features/orders/components/"
 * steer, and the #1787 precedent for cross-feature consumption via a public
 * barrel).
 *
 * FOUR STATES (issue AC):
 *   1. Filled            — an `InvoiceRecord` or `FiscalRegistrationRecord`
 *      exists; rendered inside `.doc-slot--filled` with the SAME per-status
 *      body each original panel rendered (connection lock, KV block, provider
 *      extras slot, correction flow, retry/in-doubt handling — all reused
 *      verbatim). See the KNOWN GAP note below re: corrections-as-follow-up.
 *   2. Empty + reason     — no document, and either a persisted gate-block
 *      reason (`order.salesDocumentBlockReason`, #2100/#2156) or the one
 *      client-derivable ambiguity signal for a not-yet-re-evaluated order
 *      (`resolveSalesDocumentBlockCopy` — see that module for the kind-aware
 *      copy rules: the persisted reason is document-kind-agnostic, so this
 *      panel derives `kind` locally from its own candidate pool).
 *   3 / 4. Blocked-by-other-kind — the primary action for the OTHER document
 *      kind is disabled with an explanatory `alert--warning`, distinct in tone
 *      from state 2: this is a WRITE-PATH refusal (ADR-041 §3b — the document
 *      already exists on another connection), never a routing decision. It is
 *      derived PROACTIVELY from the two queries this panel already runs
 *      (`invoice.blocksIssuanceElsewhere` / `fiscalRecord.blocksFurtherRegistration`,
 *      mirrored client-side as `!canRetryInvoice` / `!canRetryFiscalReceipt` —
 *      see the inline comment at their computation), NOT by parsing a 409 from
 *      `OrderAlreadyHasFiscalReceiptException` / `OrderAlreadyHasInvoiceException`
 *      (#2157). Proactive prevention beats reactive error-parsing here: it also
 *      matches the existing `InvoiceConnectionLock` philosophy ("no Select, so
 *      the panel can no longer be talked into issuing a SECOND document") and
 *      sidesteps a real asymmetry — `invoicing.controller.ts` maps its 409 to a
 *      structured `{ error: 'OrderAlreadyHasFiscalReceiptException', ... }`
 *      body, but `fiscalization.controller.ts` maps its mirror-image 409 to a
 *      PLAIN `ConflictException(message)` (Nest's generic `error: 'Conflict'`
 *      shape), so message-text sniffing would be the only way to reach the
 *      same discriminator from that side. Both mutations still handle a
 *      defensive 409 (below) in case the proactive read races a concurrent
 *      write from elsewhere.
 *
 * KNOWN GAP — corrections are not rendered as a linked follow-up row: a
 * correction is stored as its own separate `InvoiceRecord` row (verified:
 * neither the entity nor its ORM table carries a `correctionOf` / parent-id
 * column), and `useOrderInvoiceQuery` — like the pre-#2160 panel — reads only
 * the single LATEST record for the order (`findLatestByOrderId`). There is no
 * endpoint that lists every invoice record for one order, so once a correction
 * is issued this panel (like its predecessor) shows the CORRECTION as "the"
 * document; it cannot also show the original beside it as a follow-up. The
 * existing "Issue correction" entry point (button + `InvoiceCorrectionFlow`
 * dialog) is preserved unchanged. Building the full history view is a
 * follow-up requiring a new backend read, tracked as a deviation from the
 * mockup rather than silently approximated.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/ui/dialog';

import { useConnectionsQuery } from '../../connections';
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
import { TimeDisplay } from '../../../shared/ui/time-display';

import {
  useOrderInvoiceQuery,
  useIssueInvoiceMutation,
  resolveIssueErrorMessage,
  isMissingNumberingSeriesError,
  deriveInvoiceDisplayStatus,
  canRetryInvoice,
  resolveFailureCopy,
  isPrimaryInvoicingConnection,
  resolveIssuableConnection,
  resolveIssuingConnection,
  selectInvoicingCandidates,
  selectReauthInvoicingConnections,
  InvoiceStatusBadge,
  InvoiceConnectionLock,
  RegulatoryStatusBadge,
  DocumentTypeSelect,
  DOCUMENT_TYPE_LABEL_FALLBACK,
  InvoicePdfLink,
  resolveSalesDocumentBlockCopy,
  type InvoiceRecord,
  type SalesDocumentBlockCopyKind,
} from '../../invoicing';

import {
  useOrderFiscalRegistrationsQuery,
  useRegisterFiscalReceiptMutation,
  useReconcileFiscalRegistrationMutation,
  selectFiscalizationCandidates,
  deriveFiscalReceiptDisplayStatus,
  canRetryFiscalReceipt,
  resolveFiscalFailureCopy,
  FiscalReceiptStatusBadge,
  FiscalArtefactList,
  type FiscalRegistrationRecord,
} from '../../fiscalization';

import type { OrderRecord } from '../api/orders.types';

interface SalesDocumentPanelProps {
  order: OrderRecord;
}

/** Mirrors `buildInvoiceFieldItems` from the pre-#2160 `OrderInvoicePanel`. */
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
        <InvoicePdfLink invoiceNumber={invoice.providerInvoiceNumber} pdfUrl={invoice.pdfUrl} />
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

/** Mirrors `buildRegisteredFieldItems` from the pre-#2160 `OrderReceiptPanel`. */
function buildFiscalFieldItems(
  record: FiscalRegistrationRecord,
  t: (key: string, fallback: string) => string,
): KeyValueItem[] {
  const notReported = (
    <span className="text-muted">{t('fiscalReceipt.field.notReported', 'Not reported')}</span>
  );

  const items: KeyValueItem[] = [
    {
      id: 'documentReference',
      label: t('fiscalReceipt.field.documentReference', 'Receipt no.'),
      value: record.documentReference ?? notReported,
      mono: Boolean(record.documentReference),
    },
    {
      id: 'signingIdentity',
      label: t('fiscalReceipt.field.signingIdentity', 'Signing identity'),
      value: record.signingIdentity ?? notReported,
      mono: Boolean(record.signingIdentity),
    },
    {
      id: 'registeredAt',
      label: t('fiscalReceipt.field.registeredAt', 'Registered'),
      value: record.registeredAt ? (
        <TimeDisplay iso={record.registeredAt} format="datetime" className="mono-text" />
      ) : (
        <span className="text-muted">—</span>
      ),
    },
  ];

  if (record.regimeExtras) {
    for (const [key, value] of Object.entries(record.regimeExtras)) {
      items.push({ id: `extra-${key}`, label: key, value, mono: true });
    }
  }

  return items;
}

export function SalesDocumentPanel({ order }: SalesDocumentPanelProps): ReactElement | null {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const connectionsQuery = useConnectionsQuery();
  const demoMode = useDemoMode();

  // ── Invoicing data + actions ──────────────────────────────────────────
  const [documentType, setDocumentType] = useState<string>('invoice');
  const [pickedConnectionId, setPickedConnectionId] = useState<string | null>(null);
  const [switchTargetId, setSwitchTargetId] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [missingNumbering, setMissingNumbering] = useState(false);

  const invoiceWrite = useWriteAccess('invoices:write', demoMode);
  const invoiceQuery = useOrderInvoiceQuery(order.internalOrderId);
  const issueMutation = useIssueInvoiceMutation();

  // ── Fiscalization data + actions ──────────────────────────────────────
  const [pickedFiscalConnectionId, setPickedFiscalConnectionId] = useState<string | null>(null);
  const fiscalQuery = useOrderFiscalRegistrationsQuery(order.internalOrderId);
  const registerMutation = useRegisterFiscalReceiptMutation();
  const reconcileMutation = useReconcileFiscalRegistrationMutation();

  const allConnections = connectionsQuery.data ?? [];
  const invoicingConnections = selectInvoicingCandidates(allConnections);
  const reauthConnections = selectReauthInvoicingConnections(allConnections);
  const fiscalCandidates = selectFiscalizationCandidates(allConnections);

  const invoice = invoiceQuery.data ?? null;
  const fiscalRecords = fiscalQuery.data ?? [];
  // Newest record only — mirrors the pre-#2160 `OrderReceiptPanel` (a record on
  // a second connection is unusual but not this surface's concern to reconcile).
  const fiscalRecord = fiscalRecords[0] ?? null;

  // Loading skeleton while connections settle — matches the pre-#2160 panels.
  if (connectionsQuery.isLoading) {
    return (
      <section className="detail-section sales-document-panel sales-document-panel--loading">
        <header className="sales-document-panel__header">
          <h3 className="detail-section__title">{t('salesDocument.panel.title', 'Sales document')}</h3>
        </header>
        <div className="sales-document-panel__skeleton" aria-hidden="true" />
      </section>
    );
  }

  // Whole-panel capability gate: hide only when NOTHING exists and NOTHING
  // could be created right now. Unlike the pre-#2160 `OrderReceiptPanel`
  // (which hid unconditionally once its capability candidates list emptied,
  // even over an existing `registered` record), an existing document of
  // EITHER kind is always an accounting/registration fact and is never hidden
  // by a later capability change — matching the invoicing side's existing
  // #2047 design principle, now applied uniformly.
  if (
    invoice === null &&
    fiscalRecord === null &&
    invoicingConnections.length === 0 &&
    reauthConnections.length === 0 &&
    fiscalCandidates.length === 0
  ) {
    return null;
  }

  // ── Derived: does the existing record on the OTHER kind's behalf forbid
  // starting a NEW originating document here? Mirrors the backend's pure
  // getters (`InvoiceRecord.blocksIssuanceElsewhere` /
  // `FiscalRegistrationRecord.blocksFurtherRegistration`, #2157): both reduce
  // to "a record exists and is not a safely-retryable rejected failure" —
  // exactly `record !== null && !canRetry*(record)`. ──
  const invoiceBlocks = invoice !== null && !canRetryInvoice(invoice);
  const fiscalBlocks = fiscalRecord !== null && !canRetryFiscalReceipt(fiscalRecord);

  const showInvoiceSlot = invoice !== null;
  const showFiscalSlot = !showInvoiceSlot && fiscalRecord !== null;
  const showEmptyState = !showInvoiceSlot && !showFiscalSlot;

  // ── Invoicing connection resolution (verbatim from the pre-#2160 panel) ──
  const lock = invoice ? resolveIssuingConnection(invoice, allConnections) : null;
  const issuableConnection = invoice
    ? null
    : resolveIssuableConnection(invoicingConnections, pickedConnectionId);
  const invoicingConnection = lock ? lock.connection : issuableConnection;
  const platform = usePlatform(invoicingConnection?.platformType);
  const InvoiceDetailSection = platform?.invoiceDetailSection ?? null;
  const InvoiceCorrectionFlow = platform?.invoiceCorrectionFlow ?? null;

  const showConnectionPicker = !invoice && invoicingConnections.length > 1;
  const requiresConnectionPick = showConnectionPicker && issuableConnection === null;
  const setPrimaryTarget = invoicingConnections[0] ?? null;

  const duplicateConnectionNames = (invoice?.otherInvoicingConnectionIds ?? []).map(
    (id) => allConnections.find((c) => c.id === id)?.name ?? id,
  );

  const showRegulatoryBadge = Boolean(invoice && invoice.regulatoryStatus !== 'not-applicable');
  const switchCandidates =
    invoice && canRetryInvoice(invoice)
      ? invoicingConnections.filter((c) => c.id !== invoice.connectionId)
      : [];
  const switchTarget =
    switchCandidates.find((c) => c.id === switchTargetId) ?? switchCandidates[0] ?? null;

  const invoiceDisplayStatus = deriveInvoiceDisplayStatus(invoice);
  const invoiceSettled = !invoiceQuery.isError && !invoiceQuery.isLoading;

  const issueOn = (connection: { id: string }): void => {
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
          if (isMissingNumberingSeriesError(error)) {
            setMissingNumbering(true);
            return;
          }
          showToast({
            tone: 'error',
            title: t('invoice.action.issueFailed', 'Could not issue invoice'),
            description: resolveIssueErrorMessage(error, t),
          });
          // A 409 means the server refused: the order is already
          // issuing/issued here, or already invoiced/registered ELSEWHERE
          // (#2047 / #2157). Re-read both queries so the panel shows the real
          // record instead of the stale empty state — the proactive gate
          // above should already prevent this attempt, but a concurrent write
          // from elsewhere can still race it.
          if (error instanceof ApiError && error.status === 409) {
            void invoiceQuery.refetch();
            void fiscalQuery.refetch();
          }
        },
      },
    );
  };

  const handleIssue = (): void => {
    if (!invoicingConnection) return;
    issueOn(invoicingConnection);
  };

  // ── Fiscalization connection resolution + actions ──
  const defaultFiscalConnectionId = pickedFiscalConnectionId ?? fiscalCandidates[0]?.id ?? '';
  const fiscalRegisteringConnection =
    fiscalRecord !== null
      ? (allConnections.find((c) => c.id === fiscalRecord.connectionId) ?? null)
      : null;
  const fiscalRegisteringConnectionName =
    fiscalRegisteringConnection?.name ?? fiscalRecord?.connectionId ?? '';

  const fiscalSettled = !fiscalQuery.isError && !fiscalQuery.isLoading;
  const fiscalDisplayStatus = deriveFiscalReceiptDisplayStatus(fiscalRecord);

  const handleRegister = (connectionId: string): void => {
    if (!connectionId) return;
    registerMutation.mutate(
      { connectionId, orderId: order.internalOrderId },
      {
        onError: (error) => {
          showToast({
            tone: 'error',
            title: t('fiscalReceipt.action.registerFailed', 'Could not register receipt'),
            description: t(
              'fiscalReceipt.action.registerFailedBody',
              'The request could not be sent. Nothing was registered.',
            ),
          });
          if (error instanceof ApiError && error.status === 409) {
            void invoiceQuery.refetch();
            void fiscalQuery.refetch();
          }
        },
      },
    );
  };

  const handleReconcile = (): void => {
    if (!fiscalRecord) return;
    reconcileMutation.mutate(
      { id: fiscalRecord.id, orderId: order.internalOrderId },
      {
        onSuccess: (result) => {
          if (result.outcome === 'resolved') {
            showToast({
              tone: 'success',
              title: t('fiscalReceipt.reconcile.resolved', 'Registration confirmed'),
              description: t(
                'fiscalReceipt.reconcile.resolvedBody',
                'The provider confirmed this sale was registered.',
              ),
            });
          } else if (result.outcome === 'not-found') {
            showToast({
              tone: 'info',
              title: t('fiscalReceipt.reconcile.notFound', 'Still not found'),
              description: t(
                'fiscalReceipt.reconcile.notFoundBody',
                'The provider has no matching registration yet. This will keep checking.',
              ),
            });
          } else {
            showToast({
              tone: 'info',
              title: t('fiscalReceipt.reconcile.unsupported', 'Cannot be looked up automatically'),
              description: t(
                'fiscalReceipt.reconcile.unsupportedBody',
                'This provider cannot be queried by OpenLinker. Check its own panel directly.',
              ),
            });
          }
        },
      },
    );
  };

  // ── Cross-kind block copy (states 3 / 4 — a WRITE-PATH refusal, distinct
  // from the routing/gate-block reason below) ──
  const registerBlockedByInvoice = showInvoiceSlot && invoiceBlocks && fiscalCandidates.length > 0;
  const issueBlockedByReceipt = showFiscalSlot && fiscalBlocks && invoicingConnections.length > 0;

  // ── Empty-state routing/gate-block reason (state 2) ──
  //
  // The persisted block reason is document-kind-AGNOSTIC (#2156 resolves across
  // BOTH kinds through one shared resolver, so the columns say why nothing was
  // issued, never which kind almost was) — `kind` here is therefore derived
  // LOCALLY from this order's own candidate pool, not from the backend. Pure
  // invoice / pure fiscal-receipt render kind-specific copy; a pool that
  // genuinely spans both renders neutral "sales document" copy rather than
  // claiming a kind the data does not support.
  const blockCopyKind: SalesDocumentBlockCopyKind =
    fiscalCandidates.length === 0
      ? 'invoice'
      : invoicingConnections.length === 0
        ? 'fiscal-receipt'
        : 'mixed';
  // `requiresConnectionPick` is the one client-derivable ambiguity signal, and it
  // only exists for invoice kind (fiscalization v1 has no auto-issue/primary
  // concept — ADR-042 decision 9), so it is passed only when the pool is pure
  // invoice; a fiscal-receipt or mixed pool relies solely on the persisted reason.
  const derivedAmbiguity = blockCopyKind === 'invoice' && requiresConnectionPick;
  const blockCopy = showEmptyState
    ? resolveSalesDocumentBlockCopy(order, derivedAmbiguity, t, blockCopyKind)
    : null;

  return (
    <section className="detail-section sales-document-panel">
      <header className="sales-document-panel__header">
        <h3 className="detail-section__title">{t('salesDocument.panel.title', 'Sales document')}</h3>
        <div className="sales-document-panel__header-badges">
          {showInvoiceSlot ? (
            <>
              <InvoiceStatusBadge status={invoiceDisplayStatus} />
              {showRegulatoryBadge && invoice ? (
                <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
              ) : null}
            </>
          ) : null}
          {showFiscalSlot ? <FiscalReceiptStatusBadge status={fiscalDisplayStatus} /> : null}
        </div>
      </header>

      {/* ══════════════════════ FILLED: invoice ══════════════════════ */}
      {showInvoiceSlot ? (
        <div className="doc-slot doc-slot--filled">
          <div className="doc-slot__head">
            <span className="doc-slot__kind">{t('salesDocument.kind.invoice', 'invoice')}</span>
            {/* The number itself is surfaced once, in the KV "Number" row
                below (as a PDF link when available) — not duplicated here. */}
          </div>

          {invoiceQuery.isError ? (
            <Alert tone="error">
              {t('invoice.query.error', 'Could not load the invoice status.')}{' '}
              <Button tone="secondary" className="button--sm" onClick={() => void invoiceQuery.refetch()}>
                {t('invoice.query.retry', 'Retry')}
              </Button>
            </Alert>
          ) : null}

          {!invoiceQuery.isError && invoiceQuery.isLoading ? (
            <div className="sales-document-panel__skeleton" aria-hidden="true" />
          ) : null}

          {duplicateConnectionNames.length > 0 ? (
            <Alert tone="warning">
              <strong>
                {t('invoice.panel.duplicateTitle', 'This order has documents on more than one connection.')}
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
          ) : null}

          {invoiceSettled && invoice && lock ? (
            <InvoiceConnectionLock
              status={invoiceDisplayStatus}
              connectionName={lock.connection?.name ?? lock.connectionId}
              tag={lock.isStale ? t('invoice.lock.tagDisconnected', 'disconnected') : (lock.connection?.platformType ?? '')}
              isStale={lock.isStale}
            />
          ) : null}

          {invoiceSettled && invoiceDisplayStatus === 'issuing' ? (
            <p className="sales-document-panel__notice">
              {t(
                'invoice.issuing.body',
                'An issue attempt is in progress and this invoice is locked while it runs. It finishes or releases automatically — no action needed.',
              )}
            </p>
          ) : null}

          {invoiceSettled && invoiceDisplayStatus === 'pending' ? (
            <>
              <div className="sales-document-panel__skeleton" style={{ width: '60%' }} aria-hidden="true" />
              <p className="sales-document-panel__notice">
                {t('invoice.pending.body', 'Issuing in progress. This refreshes automatically when the provider responds.')}
              </p>
            </>
          ) : null}

          {invoiceSettled && invoiceDisplayStatus === 'issued' && invoice ? (
            <div className="sales-document-panel__body">
              <KeyValueList items={buildInvoiceFieldItems(invoice, showRegulatoryBadge, t)} />
              {InvoiceDetailSection && invoicingConnection ? (
                <InvoiceDetailSection invoice={invoice} connection={invoicingConnection} />
              ) : null}
              {InvoiceCorrectionFlow && invoicingConnection ? (
                <div className="sales-document-panel__correction">
                  <Button tone="secondary" onClick={() => setCorrectionOpen(true)} disabled={lock?.isStale ?? false}>
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
                <p className="sales-document-panel__notice">
                  {t('invoice.lock.reconnectHint', 'Reconnect this connection to act on this invoice again.')}
                </p>
              ) : null}
            </div>
          ) : null}

          {invoiceSettled && invoiceDisplayStatus === 'failed' && invoice ? (
            <>
              <div className="invoice-panel__inline-alert invoice-panel__inline-alert--error">
                <span className="invoice-panel__inline-alert-bar" />
                <span>
                  <strong>{resolveFailureCopy(invoice, t)}</strong>
                </span>
              </div>
              {canRetryInvoice(invoice) && invoiceWrite.visible ? (
                <div className="sales-document-panel__actions">
                  <span className="text-muted" style={{ fontSize: '11.5px' }}>
                    {t('invoice.failed.retryHint', 'Rejected — nothing was issued, so it is safe to retry once the cause is fixed.')}
                  </span>
                  {switchCandidates.length > 0 && switchTargetId === null ? (
                    <Button tone="secondary" className="button--sm" onClick={() => setSwitchTargetId(switchCandidates[0].id)}>
                      {t('invoice.failed.switchOpen', 'Issue on a different connection')}
                    </Button>
                  ) : null}
                  <span className="spacer" />
                  <ReadOnlyLock active={invoiceWrite.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                    <Button
                      tone="secondary"
                      onClick={handleIssue}
                      disabled={issueMutation.isPending || invoiceWrite.demoReadOnly || !invoicingConnection}
                    >
                      {t('invoice.action.retry', 'Retry')}
                    </Button>
                  </ReadOnlyLock>
                </div>
              ) : null}
              {canRetryInvoice(invoice) && invoiceWrite.visible && switchTargetId !== null && switchTarget ? (
                <div className="sales-document-panel__body">
                  <Alert tone="warning">
                    <strong>{t('invoice.failed.switchWarnTitle', 'You are moving this order to another provider.')}</strong>{' '}
                    {t(
                      'invoice.failed.switchWarnBody',
                      'The current provider rejected it and issued nothing, so this is safe - but the order then locks to the new connection and its number comes from that provider series.',
                    )}
                  </Alert>
                  <div className="sales-document-panel__actions">
                    <div className="sales-document-panel__connection">
                      <label className="sales-document-panel__connection-label" htmlFor="invoice-switch-connection">
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
                    <Button tone="secondary" className="button--sm" onClick={() => setSwitchTargetId(null)}>
                      {t('invoice.failed.switchCancel', 'Cancel')}
                    </Button>
                    <ReadOnlyLock active={invoiceWrite.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                      <Button
                        tone="primary"
                        className="button--sm"
                        onClick={() => issueOn(switchTarget)}
                        disabled={issueMutation.isPending || invoiceWrite.demoReadOnly}
                      >
                        {t('invoice.failed.switchConfirm', 'Issue here')}
                      </Button>
                    </ReadOnlyLock>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {invoiceSettled && invoiceDisplayStatus === 'in-doubt' && invoice ? (
            <>
              <div className="invoice-panel__inline-alert invoice-panel__inline-alert--warning">
                <span className="invoice-panel__inline-alert-bar" />
                <div>
                  <strong>{t('invoice.inDoubt.title', 'We could not confirm whether this invoice was issued.')}</strong>{' '}
                  {resolveFailureCopy(invoice, t)}{' '}
                  {t(
                    'invoice.inDoubt.noSwitch',
                    'Do not move it to another provider until you know - that is how one sale ends up with two invoices.',
                  )}
                </div>
              </div>
              <div className="sales-document-panel__actions">
                <span className="spacer" />
                <Button
                  tone="secondary"
                  onClick={() =>
                    showToast({
                      tone: 'info',
                      title: t('invoice.inDoubt.checkTitle', 'Check provider'),
                      description: t(
                        'invoice.inDoubt.checkBody',
                        'Open the provider portal and verify whether an invoice exists for this order.',
                      ),
                    })
                  }
                >
                  {t('invoice.inDoubt.check', 'Check provider')}
                </Button>
                <Button
                  tone="secondary"
                  onClick={() =>
                    showToast({
                      tone: 'info',
                      title: t('invoice.inDoubt.resolvedTitle', 'Marked resolved'),
                      description: t('invoice.inDoubt.resolvedBody', 'Mark-resolved is a Wave B feature — no backend endpoint yet.'),
                    })
                  }
                >
                  {t('invoice.inDoubt.resolve', 'Mark resolved')}
                </Button>
              </div>
            </>
          ) : null}

          {/* State 3: registering a receipt here would create a second document */}
          {registerBlockedByInvoice ? (
            <Alert
              tone="warning"
              title={t('salesDocument.blocked.receiptTitle', 'Registering a receipt here would create a second document')}
              action={
                <Button tone="secondary" className="button--sm" disabled>
                  {t('fiscalReceipt.action.register', 'Register receipt')}
                </Button>
              }
            >
              {t(
                'salesDocument.blocked.receiptBody',
                'This order already has an invoice from {{connection}}. Invoice or receipt — never both for one sale. Void the invoice first if a receipt is what this order actually needs.',
              ).replace('{{connection}}', lock?.connection?.name ?? lock?.connectionId ?? '')}
            </Alert>
          ) : null}
        </div>
      ) : null}

      {/* ══════════════════════ FILLED: fiscal receipt ══════════════════════ */}
      {showFiscalSlot ? (
        <div className="doc-slot doc-slot--filled">
          <div className="doc-slot__head">
            <span className="doc-slot__kind">{t('salesDocument.kind.receipt', 'fiscal receipt')}</span>
            {fiscalRecord?.documentReference ? (
              <span className="doc-slot__name mono-text">
                {fiscalRegisteringConnectionName} · {fiscalRecord.documentReference}
              </span>
            ) : null}
          </div>

          {fiscalQuery.isError ? (
            <Alert tone="error">
              {t('fiscalReceipt.query.error', 'Could not load the receipt status.')}{' '}
              <Button tone="secondary" className="button--sm" onClick={() => void fiscalQuery.refetch()}>
                {t('fiscalReceipt.query.retry', 'Retry')}
              </Button>
            </Alert>
          ) : null}

          {!fiscalQuery.isError && fiscalQuery.isLoading ? (
            <div className="sales-document-panel__skeleton" aria-hidden="true" />
          ) : null}

          {fiscalSettled && (fiscalDisplayStatus === 'pending' || fiscalDisplayStatus === 'registering') ? (
            <>
              <div className="sales-document-panel__skeleton" aria-hidden="true" />
              <p className="sales-document-panel__notice">
                {t('fiscalReceipt.pending.body', 'Sent to the provider. This refreshes automatically when it responds.')}
              </p>
            </>
          ) : null}

          {fiscalSettled && fiscalDisplayStatus === 'registered' && fiscalRecord ? (
            <div className="sales-document-panel__body">
              <KeyValueList items={buildFiscalFieldItems(fiscalRecord, t)} />
              {fiscalRecord.artefacts && fiscalRecord.artefacts.length > 0 ? (
                <FiscalArtefactList artefacts={fiscalRecord.artefacts} />
              ) : (
                <Alert tone="success">
                  {t(
                    'fiscalReceipt.registered.noArtefact',
                    'Registered, with nothing to hand over. This provider reports the registration only.',
                  )}
                </Alert>
              )}
            </div>
          ) : null}

          {fiscalSettled && fiscalDisplayStatus === 'rejected' && fiscalRecord ? (
            <>
              <Alert tone="error">{resolveFiscalFailureCopy(fiscalRecord, t)}</Alert>
              <div className="sales-document-panel__actions">
                <Button
                  tone="secondary"
                  disabled={registerMutation.isPending || !canRetryFiscalReceipt(fiscalRecord)}
                  onClick={() => handleRegister(fiscalRecord.connectionId)}
                >
                  {t('fiscalReceipt.action.retry', 'Register receipt')}
                </Button>
              </div>
            </>
          ) : null}

          {fiscalSettled && fiscalDisplayStatus === 'in-doubt' && fiscalRecord ? (
            <>
              <Alert tone="warning" title={t('fiscalReceipt.inDoubt.title', 'This sale may already be registered')}>
                {resolveFiscalFailureCopy(fiscalRecord, t)}{' '}
                {t(
                  'fiscalReceipt.inDoubt.noRetry',
                  'Registering again could produce a second fiscal receipt, so OpenLinker will not do that on its own.',
                )}
              </Alert>
              <div className="sales-document-panel__actions">
                <Button tone="secondary" disabled={reconcileMutation.isPending} onClick={handleReconcile}>
                  {t('fiscalReceipt.action.lookUp', 'Look it up')}
                </Button>
              </div>
            </>
          ) : null}

          {/* State 4: issuing an invoice here would create a second document */}
          {issueBlockedByReceipt ? (
            <Alert
              tone="warning"
              title={t('salesDocument.blocked.invoiceTitle', 'Issuing an invoice here would create a second document')}
              action={
                <Button tone="secondary" className="button--sm" disabled>
                  {t('invoice.action.issue', 'Issue invoice')}
                </Button>
              }
            >
              {t(
                'salesDocument.blocked.invoiceBody',
                'This order already has a fiscal receipt. Invoice or receipt — never both for one sale.',
              )}
            </Alert>
          ) : null}
        </div>
      ) : null}

      {/* ══════════════════════ EMPTY: reason + available actions ══════════════════════ */}
      {showEmptyState ? (
        <div className="doc-slot">
          <div className="doc-slot__head">
            <span className="doc-slot__kind">{t('salesDocument.kind.none', 'nothing issued')}</span>
          </div>

          {invoicingConnections.length === 0 && reauthConnections.length > 0 ? (
            <Alert tone="warning" title={t('invoice.panel.reauthTitle', 'Connection needs to reconnect.')}>
              {t(
                'invoice.panel.reauthBody',
                'Its access expired, so invoices cannot be issued until you re-authenticate this connection.',
              )}{' '}
              <Link className="button button--primary button--sm" to={`/connections/${reauthConnections[0].id}`}>
                {t('invoice.panel.reauth', 'Re-authenticate')}
              </Link>
            </Alert>
          ) : null}

          {blockCopy ? (
            <Alert
              tone="warning"
              title={blockCopy.title}
              action={
                setPrimaryTarget ? (
                  <Link className="button button--secondary button--sm" to={`/connections/${setPrimaryTarget.id}/edit`}>
                    {t('invoice.panel.setPrimary', 'Set a primary')}
                  </Link>
                ) : undefined
              }
            >
              {blockCopy.body}
            </Alert>
          ) : null}

          {invoiceQuery.isError ? (
            <Alert tone="error">
              {t('invoice.query.error', 'Could not load the invoice status.')}{' '}
              <Button tone="secondary" className="button--sm" onClick={() => void invoiceQuery.refetch()}>
                {t('invoice.query.retry', 'Retry')}
              </Button>
            </Alert>
          ) : null}
          {fiscalQuery.isError ? (
            <Alert tone="error">
              {t('fiscalReceipt.query.error', 'Could not load the receipt status.')}{' '}
              <Button tone="secondary" className="button--sm" onClick={() => void fiscalQuery.refetch()}>
                {t('fiscalReceipt.query.retry', 'Retry')}
              </Button>
            </Alert>
          ) : null}

          {missingNumbering && invoicingConnection ? (
            <Alert
              tone="warning"
              title={t('invoice.numbering.missingTitle', 'Numbering not configured')}
              action={
                <Link className="button button--primary button--sm" to={`/connections/${invoicingConnection.id}/numbering`}>
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

          {/* Issue-invoice affordance */}
          {invoiceSettled && invoicingConnections.length > 0 && invoiceWrite.visible ? (
            <div className="sales-document-panel__actions sales-document-panel__actions--issue">
              {showConnectionPicker ? (
                <div className="sales-document-panel__connection">
                  <label className="sales-document-panel__connection-label" htmlFor="invoice-connection">
                    {t('invoice.panel.issueOnLabel', 'Issue on')}
                  </label>
                  <Select
                    id="invoice-connection"
                    value={issuableConnection?.id ?? ''}
                    onChange={(event) => setPickedConnectionId(event.target.value || null)}
                    aria-label={t('invoice.panel.issueOnLabel', 'Issue on')}
                  >
                    <option value="">{t('invoice.panel.connectionPlaceholder', 'Select a connection…')}</option>
                    {invoicingConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {isPrimaryInvoicingConnection(c) ? `${c.name} - ${t('invoice.panel.primarySuffix', 'primary')}` : c.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <DocumentTypeSelect
                value={documentType}
                onChange={(next) => {
                  captureDemoEvent('demo_invoice_doctype_changed', { documentType: next });
                  setDocumentType(next);
                }}
                disabled={issueMutation.isPending || invoiceWrite.demoReadOnly}
                className="sales-document-panel__doc-type"
              />
              <ReadOnlyLock
                active={invoiceWrite.demoReadOnly}
                message={DEMO_READ_ONLY_ACTION_MESSAGE}
                onLockedClick={() => captureDemoEvent('demo_invoice_issue_attempted', {})}
              >
                <Button
                  tone="primary"
                  onClick={handleIssue}
                  disabled={issueMutation.isPending || invoiceWrite.demoReadOnly || invoicingConnection === null}
                >
                  {t('invoice.action.issue', 'Issue invoice')}
                </Button>
              </ReadOnlyLock>
            </div>
          ) : null}

          {/* Register-receipt affordance */}
          {fiscalSettled && fiscalCandidates.length > 0 ? (
            <div className="sales-document-panel__actions">
              <p className="panel-copy">
                {t(
                  'fiscalReceipt.notRegistered.body',
                  "No receipt has been registered for this order. Whether this sale needs one is your call, not OpenLinker's.",
                )}
              </p>
              {fiscalCandidates.length > 1 ? (
                <div className="sales-document-panel__connection">
                  <label className="sales-document-panel__connection-label" htmlFor="fiscal-connection">
                    {t('fiscalReceipt.panel.registerOnLabel', 'Register on')}
                  </label>
                  <Select
                    id="fiscal-connection"
                    value={defaultFiscalConnectionId}
                    onChange={(event) => setPickedFiscalConnectionId(event.target.value)}
                    aria-label={t('fiscalReceipt.panel.registerOnLabel', 'Register on')}
                  >
                    {fiscalCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <span className="spacer" />
              <Button tone="primary" disabled={registerMutation.isPending} onClick={() => handleRegister(defaultFiscalConnectionId)}>
                {t('fiscalReceipt.action.register', 'Register receipt')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
