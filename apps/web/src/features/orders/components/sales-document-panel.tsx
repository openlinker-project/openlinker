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
import { useCallback, useEffect, useState, type ReactElement } from 'react';
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
import { useWriteAccess, useIsAdmin } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { formatAmount } from '../../../shared/format/format-amount';
import { formatTaxRate } from '../../../shared/format/format-tax-rate';
import { useDemoMode } from '../../system';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { DocumentHeadline } from '../../../shared/ui/document-headline';
import { DocumentLifecycle } from '../../../shared/ui/document-lifecycle';
import { resolveSalesDocumentReasonCopy } from '../../sales-documents';
import { resolveInvoiceHeadline, resolveFiscalHeadline } from '../lib/sales-document-headline';

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
  InvoiceConnectionLock,
  RegulatoryStatusBadge,
  DocumentTypeSelect,
  DOCUMENT_TYPE_LABEL_FALLBACK,
  InvoicePdfLink,
  resolveSalesDocumentBlockCopy,
  resolveMissingTaxRateScope,
  splitShippingAcrossRates,
  minorUnitExponentFor,
  resolveInvoiceLifecycleSteps,
  useResendToKsefMutation,
  type InvoiceRecord,
  type SalesDocumentBlockCopyKind,
  type RateLessLine,
} from '../../invoicing';

import {
  useOrderFiscalRegistrationsQuery,
  useFiscalRegistrationProgressQuery,
  useRegisterFiscalReceiptMutation,
  useReconcileFiscalRegistrationMutation,
  selectFiscalizationCandidates,
  deriveFiscalReceiptDisplayStatus,
  canRetryFiscalReceipt,
  resolveFiscalFailureCopy,
  FiscalArtefactList,
  type FiscalRegistrationRecord,
} from '../../fiscalization';

import type { OrderRecord } from '../api/orders.types';
import { parseOrderSnapshot } from '../api/order-snapshot.schema';
import type { ParsedOrderItem, ParsedOrderTotals } from '../api/order-snapshot.schema';

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
  // #2561 — both write paths are admin-only server-side (`@Roles('admin')`);
  // the manual "pick either kind" override is gated on the same fact so a
  // non-admin session never sees a control that would 403. `useIsAdmin()` is
  // the one place `role` is compared against `'admin'` in `apps/web`.
  const isAdmin = useIsAdmin();
  // #2562 — one live region carries every wait/outcome announcement below.
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  // A live region that does not CHANGE is not re-announced, so an identical
  // consecutive outcome (retry a register, get the same answer) would be
  // silent for a screen-reader user. A zero-width suffix toggles the text
  // node without changing a single word that is read out.
  const announce = useCallback((message: string): void => {
    setLiveAnnouncement((prev) => {
      const bare = prev.replace(/\u200B$/, '');
      if (bare !== message) return message;
      return prev.endsWith('\u200B') ? message : `${message}\u200B`;
    });
  }, []);

  // ── Invoicing data + actions ──────────────────────────────────────────
  const [documentType, setDocumentType] = useState<string>('invoice');
  const [pickedConnectionId, setPickedConnectionId] = useState<string | null>(null);
  const [switchTargetId, setSwitchTargetId] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [missingNumbering, setMissingNumbering] = useState(false);

  const invoiceWrite = useWriteAccess('invoices:write', demoMode);
  const invoiceQuery = useOrderInvoiceQuery(order.internalOrderId);
  const issueMutation = useIssueInvoiceMutation();
  const resendMutation = useResendToKsefMutation();

  // ── Fiscalization data + actions ──────────────────────────────────────
  const [pickedFiscalConnectionId, setPickedFiscalConnectionId] = useState<string | null>(null);
  // #2559 — set when a register/reconcile attempt is refused because another
  // attempt already holds the exactly-once claim (a 409). It is cleared the
  // moment progress next settles, so it never survives past the attempt it
  // describes.
  // Held as the INSTANT of contention rather than a bare boolean: the clear
  // below has to wait for an answer that post-dates the 409, and a boolean
  // carries no way to tell one apart from the poll that was already on screen.
  const [contendedAt, setContendedAt] = useState<number | null>(null);
  const contended = contendedAt !== null;
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

  // ── Where the registration has got to (#2526) ──
  // Scoped to the connection the record is on, or - before any record exists -
  // the one an action here would register on, because that is the pair the
  // exactly-once key is built from.
  const fiscalProgressConnectionId =
    fiscalRecord?.connectionId ?? pickedFiscalConnectionId ?? fiscalCandidates[0]?.id ?? '';
  const fiscalProgressQuery = useFiscalRegistrationProgressQuery(
    order.internalOrderId,
    fiscalProgressConnectionId,
  );
  const fiscalProgress = fiscalProgressQuery.data?.progress;
  // The two states with work outstanding. `queued` is the one no record can
  // describe: the request has been accepted and the job has not run yet, so
  // there is nothing but the job to read.
  const fiscalWorkOutstanding = fiscalProgress === 'queued' || fiscalProgress === 'running';

  // #2559 — a contended attempt is transient by nature: once progress moves
  // past the window that produced it, the flag is stale and must clear itself
  // rather than sticking to a record it no longer describes.
  //
  // The clear waits for a progress read taken AFTER the 409. Clearing on the
  // reading already on screen would retire the flag in the same commit that
  // set it - the peer attempt has not reached `sync_jobs` yet, so the last
  // poll still says `not-requested` - and the operator would be told nothing.
  const progressUpdatedAt = fiscalProgressQuery.dataUpdatedAt;
  useEffect(() => {
    if (contendedAt === null || fiscalWorkOutstanding) return;
    if (progressUpdatedAt > contendedAt) {
      setContendedAt(null);
    }
  }, [contendedAt, fiscalWorkOutstanding, progressUpdatedAt]);

  // Loading skeleton while connections settle, sized to match the loaded
  // panel's header + one body row so the section never changes height when
  // the real content arrives (#2562).
  if (connectionsQuery.isLoading) {
    return (
      <section
        className="detail-section sales-document-panel sales-document-panel--loading"
        aria-busy="true"
      >
        <header className="sales-document-panel__header">
          <h3 className="detail-section__title">{t('salesDocument.panel.title', 'Sales document')}</h3>
        </header>
        <div className="sales-document-panel__skeleton sales-document-panel__skeleton--headline" aria-hidden="true" />
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
  // Outstanding work opens the slot even with no record. Without that, an order
  // reopened in the window right after the operator asked would fall through to
  // the empty state and offer to register the sale again.
  // `stalled` with no record is a real state - a job that gave up before
  // `register` ever wrote a row - and it is the one state whose whole purpose is
  // to say a previous request stopped. Without it here the panel falls through
  // to the empty state and says nothing at all.
  // A contended attempt (#2559) opens the slot for the same reason: a peer holds
  // the exactly-once claim RIGHT NOW, and the empty state would answer that by
  // offering to register the sale a second time.
  const showFiscalSlot =
    !showInvoiceSlot &&
    (fiscalRecord !== null ||
      fiscalWorkOutstanding ||
      contended ||
      fiscalProgress === 'stalled');
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
    announce(t('invoice.announce.issuing', 'Issuing the invoice.'));
    issueMutation.mutate(
      { connectionId: connection.id, orderId: order.internalOrderId, documentType },
      {
        onSuccess: () => {
          setSwitchTargetId(null);
          announce(t('invoice.announce.issued', 'Invoice issued.'));
          showToast({
            tone: 'success',
            title: t('invoice.action.issued', 'Invoice issued'),
            description: t('invoice.action.issuedBody', 'The invoice was issued.'),
          });
        },
        onError: (error) => {
          if (isMissingNumberingSeriesError(error)) {
            announce(
              t('invoice.announce.numberingMissing', 'Numbering is not configured.'),
            );
            setMissingNumbering(true);
            return;
          }
          announce(t('invoice.announce.issueFailed', 'The invoice could not be issued.'));
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
    announce(t('fiscalReceipt.announce.registering', 'Registering with the provider.'));
    registerMutation.mutate(
      { connectionId, orderId: order.internalOrderId },
      {
        onSuccess: () => {
          announce(t('fiscalReceipt.announce.registered', 'Registered.'));
        },
        onError: (error) => {
          // #2559 — a 409 here is the exactly-once claim refusing a SECOND
          // attempt, not a failed request: nothing was rejected and nothing
          // needs fixing, so this is the one error that gets its own tone
          // rather than the generic failure toast.
          if (error instanceof ApiError && error.status === 409) {
            setContendedAt(Date.now());
            announce(
              t('fiscalReceipt.announce.contended', 'Another attempt is already running.'),
            );
            void invoiceQuery.refetch();
            void fiscalQuery.refetch();
            return;
          }
          announce(
            t('fiscalReceipt.announce.registerFailed', 'The request could not be sent.'),
          );
          showToast({
            tone: 'error',
            title: t('fiscalReceipt.action.registerFailed', 'Could not register receipt'),
            description: t(
              'fiscalReceipt.action.registerFailedBody',
              'The request could not be sent. Nothing was registered.',
            ),
          });
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
              title: t('fiscalReceipt.reconcile.notFound', 'No registration found'),
              description: t(
                'fiscalReceipt.reconcile.notFoundBody',
                'The provider reports no registration for this sale. Nothing changed here, and OpenLinker will not register it again on its own.',
              ),
            });
          } else if (result.outcome === 'still-unknown') {
            // INTERIM (#2522/#2583). Before this branch existed `still-unknown`
            // fell into the `else` below and told the operator the provider
            // cannot be queried, which is false: the check worked and simply did
            // not settle.
            //
            // The copy names the OUTCOME and never its cause. The usual cause is
            // a provider holding the sale, but the same outcome also covers an
            // answer OpenLinker could not read, where nothing about the provider
            // is known - so saying "the provider has the sale" would assert what
            // no adapter reported, which is the defect this branch exists to
            // stop. The backend distinguishes the two on the record's `detail`;
            // whether to surface that is M9's call, not this branch's.
            showToast({
              tone: 'info',
              title: t('fiscalReceipt.reconcile.stillUnknown', 'Still not confirmed'),
              description: t(
                'fiscalReceipt.reconcile.stillUnknownBody',
                'The check did not confirm a registration, and did not find that one is missing either. Nothing changed here. You can check again.',
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
  // #2254 - the rate-less lines, read from the order's own snapshot. The remedy
  // depends on WHY a rate is absent, and only the lines say which case this is.
  // One parse, one source of truth (#2260 review): `totals` is read from the
  // same validated result as `items`, never re-read off the raw snapshot with a
  // cast - a cast is strictly more permissive than `orderTotalsSchema`, so the
  // preview could render off totals this app's own validator rejects.
  const parsedSnapshot = parseOrderSnapshot(order.orderSnapshot);
  const snapshotItems = parsedSnapshot.items;
  const rateLessLines = collectRateLessLines(snapshotItems);
  const conflictLines = snapshotItems.filter((item) => Boolean(item.taxRateChannel));
  const blockCopy = showEmptyState
    ? resolveSalesDocumentBlockCopy(order, derivedAmbiguity, t, blockCopyKind, rateLessLines)
    : null;
  // #2560 — whether a hard block leaves the manual action standing.
  // `keepsAction` is the backend-vocabulary answer (`trigger-model-manual` /
  // `trigger-model-batched` keep it; every other gate reason does not), read
  // through the same copy map the `/orders` row uses so this panel cannot
  // disagree with it about which reasons are still actionable by hand.
  // `missing-tax-rate` is carved out: it already closes the action through its
  // own disabled-with-reason control (`issueRefusal`, below), which names the
  // specific rate-less lines — a second, reason-less hide here would only
  // repeat that decision with less information beside it.
  const gateReasonCopy = showEmptyState
    ? resolveSalesDocumentReasonCopy(order.salesDocumentBlockReason ?? null, order.salesDocumentUnresolvedReason)
    : null;
  const hardBlockedNoAction =
    gateReasonCopy !== null &&
    !gateReasonCopy.keepsAction &&
    order.salesDocumentBlockReason !== 'missing-tax-rate';
  // #2561 — the manual issue/register action is only ever offered where
  // nothing has been issued yet (this whole block is the empty state), and it
  // needs an admin session because both write paths behind it are
  // admin-only server-side (`@Roles('admin')`).
  const canOverride = (isAdmin || demoMode) && !hardBlockedNoAction;
  // The demo relaxation above is visibility only - the register write is
  // admin-only server-side, so a demo non-admin sees the control locked.
  const fiscalDemoReadOnly = !isAdmin && demoMode;
  // #2254 (epic F2) - the FIRST reason where the manual path must close too.
  // Every other block reason means "auto-issue did not happen" and issuing by
  // hand is a legitimate action; this one means "this cannot be issued", and the
  // backend refuses it with a 422. A live button above a red "will not be
  // issued" alert would be an invitation to a failure OL already knows about.
  // It closes the RECEIPT path for the same reason (#2255 / #2252): a device
  // stamping a tax letter nobody confirmed onto a receipt that reaches the buyer
  // and the daily report cannot be recalled.
  const missingRateReason = order.salesDocumentBlockReason === 'missing-tax-rate';
  // #2254 - what the document's shipping line(s) will say. A mixed-rate basket
  // splits shipping proportionally, so the operator can see the shape of the
  // document before it exists; one unknown line rate makes the proportion
  // uncomputable, so the whole preview collapses to a single waiting row rather
  // than showing a split OL cannot stand behind.
  const shippingSplitPreview = renderShippingSplitPreview(snapshotItems, parsedSnapshot.totals, t);
  // #2260 review - which subject the block is about. Read once, so the copy, the
  // refusal beside the button and the receipt-side alert cannot disagree.
  const missingRateScope = missingRateReason ? resolveMissingTaxRateScope(rateLessLines) : null;
  const issueRefusal =
    missingRateScope === 'shipping'
      ? t('invoice.panel.issueRefusedShipping', 'no tax rate for the delivery charge')
      : missingRateScope === 'lines'
        ? rateLessLines.length === 1
          ? t('invoice.panel.issueRefusedOne', 'no tax rate on 1 line')
          : `${t('invoice.panel.issueRefusedPrefix', 'no tax rate on')} ${String(rateLessLines.length)} ${t('invoice.panel.issueRefusedSuffix', 'lines')}`
        : null;

  // #2557 — one headline, matching the words the `/orders` row already uses
  // for this order (M5). `kind` is `null` only in the empty state, which
  // renders "No document" rather than guessing one from the candidate pool.
  const headlineConnectionName =
    (showInvoiceSlot ? lock?.connection?.name : fiscalRegisteringConnectionName) ??
    invoicingConnection?.name ??
    '';
  const headlineModel = showInvoiceSlot
    ? resolveInvoiceHeadline(invoice, headlineConnectionName, t)
    : showFiscalSlot
      ? resolveFiscalHeadline(fiscalRecord, fiscalProgress, headlineConnectionName, contended, t)
      : { state: t('salesDocument.kind.none', 'Not issued'), tone: 'idle' as const, identity: null };

  return (
    <section className="detail-section sales-document-panel">
      <header className="sales-document-panel__header">
        <h3 className="detail-section__title">{t('salesDocument.panel.title', 'Sales document')}</h3>
        <DocumentHeadline
          kind={showInvoiceSlot ? 'invoice' : showFiscalSlot ? 'fiscal-receipt' : null}
          state={headlineModel.state}
          tone={headlineModel.tone}
          identity={headlineModel.identity}
        />
      </header>
      {/* #2562 — the one live region for every wait/outcome announcement below.
          Visually hidden: the headline and the alerts already carry the same
          words for a sighted operator. */}
      <p className="sr-only" role="status">
        {liveAnnouncement}
      </p>

      {/* #2254 - the conflict is INFORMATIONAL, never a block. The document
          exists; the two systems simply disagree about the rate, and the shop's
          won. `Alert` gives a non-error tone `role="status"`, which is the right
          politeness level for an advisory nobody has to act on immediately. */}
      {conflictLines.length > 0 ? (
        <Alert tone="conflict">
          <strong>
            {t(
              'invoice.panel.conflictTitle',
              "Issued on the shop's rate. The channel disagrees.",
            )}
          </strong>{' '}
          {conflictLines
            .map(
              (line) =>
                `${line.name ?? line.sku ?? line.id}: shop ${formatTaxRate(String(line.taxRate))}, channel ${formatTaxRate(String(line.taxRateChannel))}`,
            )
            .join('; ')}
          .
        </Alert>
      ) : null}

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
              <DocumentLifecycle kind="invoice" steps={resolveInvoiceLifecycleSteps(invoice, t)} />
              <KeyValueList items={buildInvoiceFieldItems(invoice, showRegulatoryBadge, t)} />
              {InvoiceDetailSection && invoicingConnection ? (
                <InvoiceDetailSection invoice={invoice} connection={invoicingConnection} />
              ) : null}
              {/* #2558 — a KSeF rejection is safe to re-send: the document
                  itself was already issued, only its transmission failed, so
                  the fix is to correct the connection and try that transmission
                  again, never to re-issue the document. */}
              {invoice.regulatoryStatus === 'rejected' && invoiceWrite.visible ? (
                <Alert
                  tone="error"
                  title={t('invoice.clearance.rejectedTitle', 'The authority rejected this transmission')}
                  action={
                    <ReadOnlyLock active={invoiceWrite.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                      <Button
                        tone="secondary"
                        className="button--sm"
                        disabled={resendMutation.isPending || invoiceWrite.demoReadOnly}
                        onClick={() => {
                          announce(
                            t('invoice.clearance.resending', 'Resending to the authority.'),
                          );
                          resendMutation.mutate(invoice.id, {
                            onSuccess: () => {
                              announce(
                                t('invoice.clearance.resent', 'Resent to the authority.'),
                              );
                              void invoiceQuery.refetch();
                            },
                            onError: (error) => {
                              // A 501 is structural, not transient: the connection's
                              // provider never implements `RegulatoryResubmitter` (only
                              // inFakt does), so this document can never be re-sent —
                              // retrying tells the operator to keep waiting on
                              // something that will never work (#2520's
                              // unsupported-vs-still-unknown distinction). Say so
                              // instead of reusing the generic "could not be sent"
                              // wording, which reads as a transient failure worth
                              // retrying.
                              if (error instanceof ApiError && error.status === 501) {
                                announce(
                                  t(
                                    'invoice.clearance.resendUnsupported',
                                    'This provider cannot re-send a document; issue a correction instead.',
                                  ),
                                );
                                return;
                              }
                              announce(
                                t('invoice.clearance.resendFailed', 'The resend could not be sent.'),
                              );
                            },
                          });
                        }}
                      >
                        {t('invoice.clearance.resend', 'Resend')}
                      </Button>
                    </ReadOnlyLock>
                  }
                >
                  {t(
                    'invoice.clearance.rejectedBody',
                    "The document was issued; only its transmission failed. Check this connection's configuration, then resend the same document — nothing new is issued.",
                  )}
                </Alert>
              ) : null}
              {/* #2558 — a correction is a NEW linked document, never a
                  replacement, so the affordance for it sits behind its own
                  disclosure rather than beside the record it corrects. */}
              {InvoiceCorrectionFlow && invoicingConnection ? (
                <details className="sales-document-panel__correction">
                  <summary>{t('invoice.action.issueCorrection', 'Issue correction')}</summary>
                  <p className="panel-copy">
                    {t(
                      'invoice.correction.explainer',
                      'A correction is a new document linked to this one — not a replacement, and not an edit to what was already issued.',
                    )}
                  </p>
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
                </details>
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

          {/* #2561 — this order already has a document; the override does not
              reach here, so this is a plain fact with no dead action beside
              it, never a disabled control. */}
          {registerBlockedByInvoice ? (
            <Alert
              tone="warning"
              title={t('salesDocument.blocked.receiptTitle', 'This order already has a document')}
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

          {/* #2559 — "already running" (a contended write, ADR-042) is a
              DIFFERENT fact from "I just triggered this": no elapsed counter
              and no keep-the-page-open instruction, because closing this tab
              cannot stop an attempt this session did not start. */}
          {contended ? (
            <Alert tone="info" title={t('fiscalReceipt.contended.title', 'Another attempt is already running')}>
              {t(
                'fiscalReceipt.contended.body',
                'A registration for this order is already in progress. Wait for it to finish — closing this tab will not stop it, and starting a second one is not possible.',
              )}
            </Alert>
          ) : null}

          {!contended &&
          (fiscalWorkOutstanding ||
            (fiscalProgress === undefined &&
              fiscalSettled &&
              (fiscalDisplayStatus === 'pending' || fiscalDisplayStatus === 'registering'))) ? (
            <>
              <div className="sales-document-panel__skeleton" aria-hidden="true" />
              <p className="sales-document-panel__notice">
                {/* The work runs in the background since #2525, so this no
                    longer asks anyone to wait with the page open. It says what
                    is true and nothing more: it continues, and it will be here.
                    There is deliberately no estimate - OpenLinker hands the sale
                    over and waits for one answer, observing nothing in between. */}
                {t(
                  'fiscalReceipt.pending.body',
                  'Registering with the provider. This continues if you leave the page, and the result will be here when you come back.',
                )}
              </p>
            </>
          ) : null}

          {/* Nothing is running. Two states, two sentences, because they differ
              on whether the provider can already have been called - and an
              absence is not something this surface may assert on a guess. */}
          {fiscalProgress === 'stalled' ? (
            <Alert
              tone="warning"
              title={t('fiscalReceipt.stalled.title', 'Nothing is running for this receipt')}
            >
              {t(
                'fiscalReceipt.stalled.body',
                'The registration was requested and stopped before it reached the provider, so nothing was registered. Asking again picks it up.',
              )}{' '}
              <Button
                tone="secondary"
                className="button--sm"
                disabled={registerMutation.isPending || !fiscalProgressConnectionId}
                onClick={() => handleRegister(fiscalProgressConnectionId)}
              >
                {t('fiscalReceipt.action.retry', 'Register receipt')}
              </Button>
            </Alert>
          ) : null}

          {fiscalProgress === 'interrupted' ? (
            <Alert
              tone="warning"
              title={t('fiscalReceipt.interrupted.title', 'An attempt stopped without an answer')}
            >
              {t(
                'fiscalReceipt.interrupted.body',
                'The attempt had started, so OpenLinker cannot tell whether the provider registered this sale. Asking again resumes the same registration rather than starting a new one.',
              )}{' '}
              <Button
                tone="secondary"
                className="button--sm"
                disabled={registerMutation.isPending || !fiscalProgressConnectionId}
                onClick={() => handleRegister(fiscalProgressConnectionId)}
              >
                {t('fiscalReceipt.action.retry', 'Register receipt')}
              </Button>
            </Alert>
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
              {/* #2559 — a registered receipt is final. OpenLinker never issues
                  a fiscal correction, so this state must not imply one is
                  possible here. */}
              <p className="sales-document-panel__notice">
                {t(
                  'fiscalReceipt.registered.final',
                  'This registration is final and cannot be corrected here.',
                )}
              </p>
            </div>
          ) : null}

          {fiscalSettled && fiscalDisplayStatus === 'rejected' && fiscalRecord ? (
            <>
              <Alert tone="error">
                {resolveFiscalFailureCopy(fiscalRecord, t)}{' '}
                {t(
                  'fiscalReceipt.rejected.retrySafe',
                  'Nothing was created, so registering again is safe.',
                )}
              </Alert>
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

          {/* #2561 — same rule as the invoice slot above: a plain fact, no
              dead action beside it. */}
          {issueBlockedByReceipt ? (
            <Alert
              tone="warning"
              title={t('salesDocument.blocked.invoiceTitle', 'This order already has a document')}
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

          {/* #2561 — the routing explanation, as a disclosure directly above
              the manual override below it. Open by default: this is the fact
              the operator most needs, and a control below (`canOverride`)
              exists only once they have read it. */}
          {blockCopy ? (
            <details className="sales-document-panel__routing-disclosure" open>
              <summary>{blockCopy.title}</summary>
              <Alert
                tone="warning"
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
            </details>
          ) : null}

          {/* #2254 (epic F6) - the return path. Every remedy in this epic leaves
              the app, is applied in a system OpenLinker does not read live, and
              returns the operator to a screen that still says the old thing.
              Without naming the latency, a correct fix looks like it did nothing
              and the operator concludes the product is broken.

              It links to the products list rather than opening a sync dialog
              here: the connection to sync is the SHOP that owns the product,
              which this panel does not know - it knows document connections. A
              control that synced the wrong connection would be worse than a link
              to the one screen that does know. */}
          {/* `taxRateState` is the param the products list reads (#2260 review);
              `taxRate` is the ORDERS list's own conflict filter, and pointing
              here at that one landed on the unfiltered catalogue with no signal
              the filter had been ignored. Only rendered for a LINE-scoped block:
              a delivery charge with nowhere to sit is not fixed in the
              catalogue, so the link would point at the wrong screen. */}
          {missingRateScope === 'lines' ? (
            <p className="panel-copy">
              {t(
                'invoice.panel.fixAndRecheck',
                'Rates are read during product sync, so a fix in the shop shows up on the next one.',
              )}{' '}
              <Link to="/products?taxRateState=missing">
                {t('invoice.panel.fixAndRecheckAction', 'Fix and re-check')}
              </Link>
            </p>
          ) : null}

          {/* #2254 - the shipping split preview lives HERE, not on the line-items
              panel, because shipping has no order line: it is composed when the
              document is. A single `waiting` row while any line rate is unknown,
              since one unknown makes the proportion uncomputable. */}
          {shippingSplitPreview}

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

          {/* Issue-invoice affordance — the override (#2561): admin-only, and
              refused once a hard block already says the manual path is
              closed too. */}
          {invoiceSettled && invoicingConnections.length > 0 && invoiceWrite.visible && canOverride ? (
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
                  disabled={
                    issueMutation.isPending ||
                    invoiceWrite.demoReadOnly ||
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
              <p className="text-muted sales-document-panel__scope-note">
                {t('salesDocument.override.scopeNote', 'This applies to this order only.')}
              </p>
            </div>
          ) : null}

          {/* Register-receipt affordance — the override (#2561), same gate. */}
          {fiscalSettled && fiscalCandidates.length > 0 && canOverride ? (
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
              {/* #2255 / #2252 - the same rule as the invoice, on the receipt
                  path. The per-connection tax letter is NOT used to fill the
                  gap: a receipt carrying an unconfirmed rate reaches the buyer
                  and the daily report and cannot be recalled, so the accepted
                  cost is late registration. */}
              {/* Gated on the REASON, not on a line count (#2260 review): the
                  Register button below is disabled on the reason alone, and a
                  dead control with nothing beside it reads as a bug. A
                  shipping-scope block has no rate-less line to name, so it gets
                  its own true sentence rather than a count it cannot support. */}
              {missingRateScope !== null ? (
                <Alert tone="error">
                  <strong>
                    {missingRateScope === 'shipping'
                      ? t(
                          'fiscalReceipt.blockNoRateShippingTitle',
                          'Not registered: the delivery charge has no tax rate.',
                        )
                      : rateLessLines.length === 1
                        ? t(
                            'fiscalReceipt.blockNoRateTitleOne',
                            'Not registered: 1 line has no tax rate.',
                          )
                        : `${t('fiscalReceipt.blockNoRateTitlePrefix', 'Not registered:')} ${String(rateLessLines.length)} ${t('fiscalReceipt.blockNoRateTitleSuffix', 'lines have no tax rate.')}`}
                  </strong>{' '}
                  {missingRateScope === 'shipping'
                    ? t(
                        'fiscalReceipt.blockNoRateShippingBody',
                        "Every product line has a rate, but nothing in this order carries an amount the delivery charge could follow. Check the order's lines and delivery charge.",
                      )
                    : t(
                        'fiscalReceipt.blockNoRateBody',
                        "Add the rate in the shop's catalogue and re-sync the product. The connection's tax letter is not used to fill the gap.",
                      )}
                </Alert>
              ) : null}
              <span className="spacer" />
              {/* `canOverride` deliberately admits a demo viewer so the
                  affordance is discoverable (#1615), but the write behind it is
                  `@Roles('admin')` - so a demo non-admin gets the locked
                  treatment rather than a control that would 403. */}
              <ReadOnlyLock
                active={fiscalDemoReadOnly}
                message={DEMO_READ_ONLY_ACTION_MESSAGE}
                onLockedClick={() => captureDemoEvent('demo_fiscal_register_attempted', {})}
              >
                <Button
                  tone="primary"
                  disabled={
                    registerMutation.isPending || missingRateReason || fiscalDemoReadOnly
                  }
                  onClick={() => handleRegister(defaultFiscalConnectionId)}
                >
                  {t('fiscalReceipt.action.register', 'Register receipt')}
                </Button>
              </ReadOnlyLock>
              <p className="text-muted sales-document-panel__scope-note">
                {t('salesDocument.override.scopeNote', 'This applies to this order only.')}
              </p>
            </div>
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
    }));
}

/**
 * The shipping line(s) the document will carry (#2254).
 *
 * Rendered on the sales-document panel rather than beside the order's line
 * items, because shipping has no order line: it exists only once a document is
 * being composed. One rate in the basket means one shipping line at that rate;
 * a mixed basket means several, split in proportion to line gross.
 *
 * A single unknown line rate collapses the whole thing to one `waiting` row.
 * Showing a partial split would state a proportion OpenLinker cannot compute,
 * and the document is held anyway.
 */
function renderShippingSplitPreview(
  items: readonly ParsedOrderItem[],
  totals: ParsedOrderTotals | undefined,
  t: (key: string, fallback: string) => string,
): ReactElement | null {
  const shipping = totals?.shipping ?? 0;
  if (!Number.isFinite(shipping) || shipping <= 0 || items.length === 0) return null;

  const anyUnknown = items.some((item) => !item.taxRate);
  if (anyUnknown) {
    return (
      <p className="panel-copy">
        {t(
          'invoice.panel.shippingSplitWaiting',
          'Shipping is waiting with the document: it is split across the rates in the basket, and one line has no rate yet.',
        )}
      </p>
    );
  }

  // The arithmetic is the document's own, not a lookalike: `splitShippingAcrossRates`
  // is the mirror of the core function the document is composed with, so the
  // parts previewed here add up to the shipping the buyer paid.
  const parts = splitShippingAcrossRates(
    shipping,
    items.map((item) => ({
      taxRate: item.taxRate ?? null,
      gross: item.price * item.quantity,
    })),
    minorUnitExponentFor(totals?.currency),
  );
  // `null` past the unknown-rate check means there was nothing to be
  // proportional to (every line grosses zero). Claim nothing rather than
  // preview a split that does not exist.
  if (parts === null || parts.length <= 1) return null;

  return (
    <p className="panel-copy">
      {t('invoice.panel.shippingSplit', 'Shipping is split across the rates in this basket:')}{' '}
      {parts
        .map(
          (part) => `${formatAmount(part.amount, totals?.currency)} at ${formatTaxRate(part.taxRate)}`,
        )
        .join(', ')}
      .
    </p>
  );
}
