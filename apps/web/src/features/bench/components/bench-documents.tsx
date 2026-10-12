/**
 * The paper that travels with the box (#2418, `W3b-5`, Surface F)
 *
 * What goes INSIDE the box, what goes ON it, and the one state where a finished
 * box cannot go out at all.
 *
 * ## The bench PRINTS; it never ISSUES (F1)
 *
 * Nothing here creates a document. Both papers were made earlier, away from this
 * bench, and the copy says so to the packer rather than leaving them to work it
 * out from the absence of a "create" button. That is also why a missing invoice
 * has no retry: there is nothing at a bench that could make one.
 *
 * ## A missing invoice NEVER blocks (F2/D17)
 *
 * It is named — in the sales-document vocabulary the rest of the product already
 * uses, resolved through `features/sales-documents`' own guarded map rather than
 * a second copy of it — and the box goes out. A tax-rate gap is an office
 * problem the packer cannot fix, and refusing to pack would pile boxes at a
 * bench while somebody hunts for an administrator. That is the shape of every
 * fail-closed gate that gets switched off within a week.
 *
 * ## Every document, in every status (#3647)
 *
 * The card is chosen by `describeBenchDocumentCard` from the order's sales
 * document of either kind: an invoice or a fiscal receipt, being made, made,
 * rejected or not confirmed. "No invoice was made" is reached only when no
 * document of any kind exists. A registered receipt's body and actions may be
 * replaced per integration through `platform.benchReceiptSection`; the badge,
 * top line and title stay the host's.
 *
 * ## Two mockup controls are deliberately NOT rendered
 *
 * Two of the mockup's controls are deliberately absent, for the same reason: a
 * control wired to nothing is worse than a missing one on a surface worked at
 * speed. *"Put the box on the problem shelf"* has no backend behind it —
 * nothing records a shelf. And *"Try the label again"* has nothing to retry: a
 * label that EXISTS is reported `ready`, where the Print control re-fetches
 * every time it is pressed, so this arm is reached only when none was ever
 * produced — and buying one needs the address and the box measurements, which
 * are deliberately not on this screen. The panel names the owner instead.
 *
 * A third one, *"Show camera preview"*, was briefly rendered anyway (#3420) on
 * the argument that copy beside it admitted it did nothing. It is gone. A
 * disclaimer does not make a dead control useful — the packer still reaches
 * for it, reads that it was never real, and has lost the second it took. The
 * rule the other two omissions follow has no exception.
 *
 * @module apps/web/src/features/bench/components
 */
import { useState, type ReactElement, type ReactNode } from 'react';

import { useApiClient } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useSession } from '../../../shared/auth/use-session';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { usePlatform } from '../../../shared/plugins';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useDemoMode } from '../../system';
import type { BenchLabel, BenchLabelReplaceResult } from '../api/bench-parcel.types';
import {
  useBenchDocumentsQuery,
  useBenchReceiptLinkQuery,
  useBenchUnlabelledQuery,
} from '../hooks/use-bench-documents-query';
import {
  describeInvoiceAbsenceAudience,
  describeInvoiceBlock,
} from '../lib/bench-parcel-presentation';
import { benchParcelCopy } from '../lib/bench-parcel.copy';
import { printBlob } from '../lib/bench-print';
import { describeBenchDocumentCard, type BenchDocumentCard } from '../lib/bench-sales-document';
import { BenchChangeParcelDialog } from './bench-change-parcel-dialog';

/**
 * Maps the three audiences onto their copy. A `Record` rather than a chain of
 * ternaries so that adding a fourth audience is a compile error here, not a
 * silently-unreachable branch — the bug this whole seam exists to fix was a
 * message that rendered where it did not apply.
 */
const AUDIENCE_COPY: Record<
  ReturnType<typeof describeInvoiceAbsenceAudience>,
  { readonly title: string; readonly body: string }
> = {
  'on-office-list': benchParcelCopy.documents.audience.onOfficeList,
  'issued-on-request': benchParcelCopy.documents.audience.issuedOnRequest,
  'nobody-told': benchParcelCopy.documents.audience.nobodyTold,
};

export interface BenchDocumentsPanelProps {
  readonly workId: string;
  /** Units verified into the box, for the unlabelled state's reassurance line. */
  readonly unitsPacked: number;
  /**
   * Whether the box is closed. The unlabelled block says "packed … and it is
   * closed", so it is true only of a closed box: on an open one a missing
   * label is not yet a problem at this bench, and the label card says so
   * instead (G03-6 found the block on a parcel at "0 of 1").
   */
  readonly closed: boolean;
}

/**
 * What the carrier said, from what a PACKER is allowed to see.
 *
 * `carrierMessage` is `null` for a caller without `shipments:write` — the raw
 * rejection text may embed address fragments — which is every packer, so the
 * short code stands in. Where there is neither, the panel distinguishes two
 * facts a single sentence would have blurred: a reason exists but this role may
 * not read it (`carrierMessageRedacted`), and the carrier genuinely gave none.
 * Printing the second when the first is true is the surface stating something
 * false, which is worse than saying less.
 */
function describeCarrierRefusal(label: BenchLabel): string {
  if (label.carrierMessage !== null && label.carrierMessage.trim().length > 0) {
    return benchParcelCopy.unlabelled.carrierQuote(label.carrierMessage);
  }
  if (label.providerCode !== null && label.providerCode.trim().length > 0) {
    return benchParcelCopy.unlabelled.carrierCode(label.providerCode);
  }
  return label.carrierMessageRedacted
    ? benchParcelCopy.unlabelled.carrierHidden
    : benchParcelCopy.unlabelled.carrierUnknown;
}

export function BenchDocumentsPanel({
  workId,
  unitsPacked,
  closed,
}: BenchDocumentsPanelProps): ReactElement | null {
  const apiClient = useApiClient();
  const documents = useBenchDocumentsQuery(workId);
  const [printError, setPrintError] = useState<string | null>(null);
  // #3655 - Change size. `voidNotice` outlives the dialog and the label card:
  // after `cancelled-not-replaced` there is no card to hang it on.
  const [changeSizeOpen, setChangeSizeOpen] = useState(false);
  const [replaceOutcome, setReplaceOutcome] = useState<BenchLabelReplaceResult | null>(null);
  // `bench:write` with the real demo flag, as `bench-work-list.tsx` does: a demo
  // viewer sees Change size disabled under `ReadOnlyLock` rather than not at
  // all, so the capability is advertised (#1615).
  const demoMode = useDemoMode();
  const write = useWriteAccess('bench:write', demoMode);
  const voidNotice =
    replaceOutcome?.outcome === 'cancelled-not-replaced'
      ? replaceOutcome.voidState === 'confirmed'
        ? { title: benchParcelCopy.changeSize.voidTitle, body: benchParcelCopy.changeSize.voidBody }
        : {
            title: benchParcelCopy.changeSize.voidDoubtTitle,
            body: benchParcelCopy.changeSize.voidDoubtBody,
          }
      : null;
  // #3404 — the signed-in PACKER's own binding, never the order's. `?? null`
  // rather than `undefined`: a session predating this field must read as
  // "unset" the same way an explicit clear does.
  const { session } = useSession();
  const stationLabel = session.user?.packStationLabel ?? null;

  const data = documents.data;
  const labelUnavailable = data?.label.state === 'unavailable';
  // F3/F4 is a fact about a FINISHED box. An open box with no label yet gets
  // the neutral pending card below, never "this box cannot go out".
  const unlabelled = labelUnavailable && closed;
  const labelPending = labelUnavailable && !closed;
  // Only asked for while this bench is actually looking at an unlabelled box.
  const others = useBenchUnlabelledQuery({ enabled: unlabelled });

  const card: BenchDocumentCard | null = data === undefined ? null : describeBenchDocumentCard(data);
  const receiptMade = card?.kind === 'receipt-made' ? card : null;
  // Fetched as soon as the card offers the link, so "Open receipt" is a plain
  // link the browser opens directly (#3647).
  const receiptLink = useBenchReceiptLinkQuery(workId, {
    enabled: receiptMade?.handover === 'link',
  });
  const platform = usePlatform(receiptMade?.platformType ?? undefined);
  const ReceiptSection = platform?.benchReceiptSection ?? null;

  if (data === undefined || card === null) return null;

  const label = data.label;

  const print = (
    download: (id: string) => Promise<Blob>,
    onConflict: string = benchParcelCopy.documents.printFailed
  ): void => {
    setPrintError(null);
    void download(workId)
      .then((blob) => {
        if (!printBlob(blob)) setPrintError(benchParcelCopy.documents.printFailed);
      })
      .catch((error: unknown) => {
        // A 409 is the provider saying it has nothing to print - a statement
        // about the document, not a transient failure, so it is not "try again".
        setPrintError(
          error instanceof ApiError && error.isConflict()
            ? onConflict
            : benchParcelCopy.documents.printFailed
        );
      });
  };
  const printInvoice = (): void => {
    print(
      (id) => apiClient.bench.downloadInvoice(id),
      benchParcelCopy.documents.printNotAvailable
    );
  };
  const printReceipt = (): void => {
    print((id) => apiClient.bench.downloadReceipt(id));
  };
  const bothPrint =
    (card.kind === 'invoice-ready' ||
      (card.kind === 'receipt-made' && card.handover === 'document')) &&
    label.state === 'ready';

  const printLabel = (onFailure?: () => void): void => {
    setPrintError(null);
    if (label.shipmentId === null) {
      setPrintError(benchParcelCopy.documents.printFailed);
      return;
    }
    // Through the WORK, never the shipment id — this is the route that
    // stamps the print (#3340). `apiClient.shipments.downloadLabel` still
    // exists for every other caller of a shipment's label, but it does not.
    void apiClient.bench
      .downloadLabel(workId)
      .then((blob) => {
        if (!printBlob(blob)) setPrintError(benchParcelCopy.documents.printFailed);
      })
      .catch(() => {
        if (onFailure) onFailure();
        else setPrintError(benchParcelCopy.documents.printFailed);
      });
  };

  return (
    <section className="bench-documents" data-testid="bench-documents">
      {printError === null ? null : <Alert tone="warning">{printError}</Alert>}

      {/* Never a success state: the old label is void (or, in doubt, may be)
          and nothing replaced it. */}
      {voidNotice === null ? null : (
        <Alert tone="warning" title={voidNotice.title} data-testid="bench-label-void">
          <p>{voidNotice.body}</p>
          <Button
            tone="secondary"
            className="bench-documents__touch"
            onClick={() => {
              setReplaceOutcome(null);
            }}
          >
            {benchParcelCopy.changeSize.voidDismiss}
          </Button>
        </Alert>
      )}
      {replaceOutcome?.outcome === 'replaced' ? (
        <Alert tone="success" data-testid="bench-label-replaced">
          {replaceOutcome.keptTemplate === null
            ? benchParcelCopy.changeSize.replacedNotice
            : benchParcelCopy.changeSize.replacedKeptSizeNotice(replaceOutcome.keptTemplate)}
        </Alert>
      ) : null}

      {/* F1, said before either control: neither paper is made here. */}
      {bothPrint ? (
        <div className="bench-documents__intro">
          <h3>{benchParcelCopy.documents.readyTitle}</h3>
          <p>{benchParcelCopy.documents.readyBody}</p>
        </div>
      ) : null}

      {/* ── F3/F4 — packed, and it cannot go out. ─────────────────────────── */}
      {unlabelled ? (
        <div className="bench-documents__unlabelled" data-testid="bench-documents-unlabelled">
          <p className="eyebrow">{benchParcelCopy.unlabelled.eyebrow}</p>
          <h3 className="bench-documents__title">{benchParcelCopy.unlabelled.title}</h3>
          <StatusBadge tone="error" withDot>
            {benchParcelCopy.unlabelled.badge}
          </StatusBadge>
          {/* "Do not open it and do not check it again" — the box is correct;
              only the label is outstanding. */}
          <p>{benchParcelCopy.unlabelled.body(unitsPacked)}</p>

          <div className="bench-documents__carrier">
            <h4>{benchParcelCopy.unlabelled.carrierHeading}</h4>
            <p className="bench-documents__carrier-said">{describeCarrierRefusal(label)}</p>
            <p>{benchParcelCopy.unlabelled.carrierReassurance}</p>
          </div>

          {/* No "try again" control here, and its absence is the decision.
              A label that EXISTS is reported `ready`, where the Print control
              re-fetches every time it is pressed — so a transient fetch failure
              is already retried by pressing it again. This arm is reached only
              when no label was ever produced, and buying one needs the address
              and the box measurements, which are deliberately not on this
              screen. A control wired to something that cannot succeed is worse
              than none, so the panel names the owner instead. */}
          <p className="bench-documents__not-retryable">
            {benchParcelCopy.unlabelled.notRetryable}
          </p>

          <div className="bench-documents__dispatch">
            <h4>{benchParcelCopy.unlabelled.dispatchTitle}</h4>
            <p>{benchParcelCopy.unlabelled.dispatchBody}</p>
            {/* One read, two audiences — which is what stops the bench and
                dispatch disagreeing about a box on a floor. `here` is this box;
                the rest of the list is what dispatch is looking at. */}
            {others.data === undefined ? null : (
              <StatusBadge tone="neutral">
                {benchParcelCopy.unlabelled.counts({
                  here: 1,
                  inDispatch: Math.max(0, others.data.total - 1),
                })}
              </StatusBadge>
            )}
          </div>
        </div>
      ) : null}

      {/* The mockup's `.docs`: the two papers side by side as cards, so a
          packer sees at a glance that one goes IN the box and one goes ON it.
          The grid takes 1 or 2 children — the label card is suppressed while
          the parcel is unlabelled, which has its own treatment above. */}
      <div className="bench-documents__cards">
      {/* ── The sales document: an invoice or a fiscal receipt. ──────────── */}
      <div
        className={`bench-documents__card ${
          isReceiptCard(card) ? 'bench-documents__receipt' : 'bench-documents__invoice'
        }`}
        data-testid={isReceiptCard(card) ? 'bench-documents-receipt' : 'bench-documents-invoice'}
        data-card={card.kind}
      >
        {renderDocumentCard(card, {
          printInvoice,
          defaultReceiptBody:
            receiptMade === null
              ? null
              : renderDefaultReceiptBody(receiptMade, {
                  printReceipt,
                  linkUrl: receiptLink.data?.url ?? null,
                  // A retry keeps the query in `error` while it refetches, so
                  // the card shows the pending state for it, not the old failure.
                  linkFailed: receiptLink.isError && !receiptLink.isFetching,
                  retryLink: () => {
                    void receiptLink.refetch();
                  },
                }),
          ReceiptSection:
            receiptMade === null || ReceiptSection === null
              ? null
              : (defaultBody: ReactNode): ReactNode => (
                  <ReceiptSection
                    workId={workId}
                    documentReference={receiptMade.documentReference}
                    artefacts={receiptMade.artefacts}
                    defaultBody={defaultBody}
                  />
                ),
        })}
      </div>

      {/* ── The label: on the box. Suppressed on a closed unlabelled box,
             which has its own treatment above, and while the void notice is
             up: an in-doubt void leaves the shipment row looking live, and a
             Print control beside "do not use the old label" would contradict
             it. On an OPEN box with no label yet, a neutral card keeps the
             slot and the packer packing. ─────────────────────────────────── */}
      {label.state === 'ready' && voidNotice === null ? (
        <div
          className="bench-documents__card bench-documents__label"
          data-testid="bench-documents-label"
        >
          <StatusBadge tone="success" withDot>
            {benchParcelCopy.documents.readyBadge}
          </StatusBadge>
          <span className="bench-documents__slot">{benchParcelCopy.documents.onLabel}</span>
          <h3>{benchParcelCopy.documents.labelTitle()}</h3>
          {label.trackingNumber === null ? null : (
            <p className="bench-documents__tracking">
              {benchParcelCopy.documents.trackingLabel}: {label.trackingNumber}
            </p>
          )}
          <p>{benchParcelCopy.documents.labelHint}</p>
          <div className="bench-documents__actions">
            <Button
              tone="primary"
              className="bench-documents__touch"
              onClick={() => {
                printLabel();
              }}
            >
              {benchParcelCopy.documents.printLabelAction}
            </Button>
            {label.shipmentId !== null && write.visible ? (
              <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                <Button
                  tone="secondary"
                  className="bench-documents__touch"
                  disabled={write.demoReadOnly}
                  onClick={() => {
                    setChangeSizeOpen(true);
                  }}
                >
                  {benchParcelCopy.documents.changeSizeAction}
                </Button>
              </ReadOnlyLock>
            ) : null}
          </div>
        </div>
      ) : labelPending ? (
        <div
          className="bench-documents__card bench-documents__label"
          data-testid="bench-documents-label-pending"
        >
          <StatusBadge tone="neutral" withDot>
            {benchParcelCopy.documents.labelPendingBadge}
          </StatusBadge>
          <span className="bench-documents__slot">{benchParcelCopy.documents.onLabel}</span>
          <h3>{benchParcelCopy.documents.labelPendingTitle}</h3>
          <p>{benchParcelCopy.documents.labelPendingBody}</p>
        </div>
      ) : null}
      </div>

      {/* The mockup's printer-binding line, made from the signed-in packer's
          own `packStationLabel` (#3404) — never this parcel's, never the
          order's. Rendered NOTHING when unset: an empty "Printing to —" line
          is noise at a touch screen, not reassurance. */}
      {stationLabel === null ? null : (
        <p className="bench-documents__printer" data-testid="bench-documents-printer">
          <span className="bench-documents__printer-dot" aria-hidden="true" />
          {benchParcelCopy.documents.printingTo(stationLabel)}
        </p>
      )}

      <BenchChangeParcelDialog
        workId={workId}
        open={changeSizeOpen}
        onOpenChange={setChangeSizeOpen}
        templates={label.parcelTemplates ?? []}
        onResolved={(result) => {
          setChangeSizeOpen(false);
          setReplaceOutcome(result);
        }}
      />

      {unlabelled && card.kind === 'invoice-ready' ? (
        <p className="bench-documents__invoice-still-fine">
          {benchParcelCopy.unlabelled.invoiceStillFine}
        </p>
      ) : null}
    </section>
  );
}

function isReceiptCard(card: BenchDocumentCard): boolean {
  return card.kind.startsWith('receipt-');
}

interface DocumentCardActions {
  readonly printInvoice: () => void;
  readonly defaultReceiptBody: ReactNode;
  /** Set when the receipt's integration registers `benchReceiptSection`. */
  readonly ReceiptSection: ((defaultBody: ReactNode) => ReactNode) | null;
}

/**
 * The host frame of every document card: badge, top line and title. A plugin
 * never replaces these - they are the statement of status, and the host owns it.
 */
function CardFrame({
  tone,
  badge,
  slot,
  title,
  children,
}: {
  readonly tone: 'success' | 'warning' | 'info' | 'neutral';
  readonly badge: string;
  readonly slot: string;
  readonly title: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <>
      <StatusBadge tone={tone} withDot>
        {badge}
      </StatusBadge>
      <span className="bench-documents__slot">{slot}</span>
      <h3>{title}</h3>
      {children}
    </>
  );
}

function renderDocumentCard(card: BenchDocumentCard, actions: DocumentCardActions): ReactNode {
  const copy = benchParcelCopy.documents;
  const stillGoes = copy.doesNotStop;
  const tellOffice = `${copy.doesNotStop} ${copy.mentionOffice}`;

  switch (card.kind) {
    case 'invoice-ready':
      return (
        <CardFrame
          tone="success"
          badge={copy.readyBadge}
          slot={copy.insideLabel}
          title={copy.invoiceTitle(card.documentNumber)}
        >
          <p>{copy.invoiceHint}</p>
          <Button tone="secondary" onClick={actions.printInvoice}>
            {copy.printInvoiceAction}
          </Button>
        </CardFrame>
      );
    case 'invoice-not-printable':
      return (
        <CardFrame
          tone="neutral"
          badge={copy.notPrintableBadge}
          slot={copy.insideLabel}
          title={copy.notPrintableTitle(card.documentNumber)}
        >
          <p>{copy.notPrintableBody}</p>
        </CardFrame>
      );
    case 'invoice-link':
      return (
        <CardFrame
          tone="info"
          badge={copy.link.badge}
          slot={copy.insideLabel}
          title={copy.invoiceTitle(card.documentNumber)}
        >
          <p>{copy.link.body}</p>
          <a
            className="button button--secondary"
            href={card.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.link.openAction}
          </a>
        </CardFrame>
      );
    case 'invoice-in-progress':
      return (
        <CardFrame
          tone="info"
          badge={copy.invoiceStatus.inProgressBadge}
          slot={copy.insideLabelMissing}
          title={copy.invoiceStatus.inProgressTitle}
        >
          <p>{stillGoes}</p>
        </CardFrame>
      );
    case 'invoice-rejected':
      return (
        <CardFrame
          tone="warning"
          badge={copy.invoiceStatus.rejectedBadge}
          slot={copy.insideLabelMissing}
          title={copy.invoiceStatus.rejectedTitle}
        >
          <p>{tellOffice}</p>
        </CardFrame>
      );
    case 'invoice-not-confirmed':
      return (
        <CardFrame
          tone="warning"
          badge={copy.invoiceStatus.notConfirmedBadge}
          slot={copy.insideLabelMissing}
          title={copy.invoiceStatus.notConfirmedTitle}
        >
          <p>{`${copy.invoiceStatus.notConfirmedBody} ${tellOffice}`}</p>
        </CardFrame>
      );
    case 'receipt-in-progress':
      return (
        <CardFrame
          tone="info"
          badge={copy.receipt.inProgressBadge}
          slot={copy.receipt.slot}
          title={copy.receipt.inProgressTitle}
        >
          <p>{stillGoes}</p>
        </CardFrame>
      );
    case 'receipt-made':
      return (
        <CardFrame
          tone="success"
          badge={copy.receipt.madeBadge}
          slot={copy.receipt.slot}
          title={copy.receipt.title(card.documentReference)}
        >
          {actions.ReceiptSection === null
            ? actions.defaultReceiptBody
            : actions.ReceiptSection(actions.defaultReceiptBody)}
        </CardFrame>
      );
    case 'receipt-rejected':
      return (
        <CardFrame
          tone="warning"
          badge={copy.receipt.rejectedBadge}
          slot={copy.receipt.slot}
          title={copy.receipt.rejectedTitle}
        >
          <p>{tellOffice}</p>
        </CardFrame>
      );
    case 'receipt-not-confirmed':
      return (
        <CardFrame
          tone="warning"
          badge={copy.receipt.notConfirmedBadge}
          slot={copy.receipt.slot}
          title={copy.receipt.notConfirmedTitle}
        >
          <p>{`${copy.receipt.notConfirmedBody} ${tellOffice}`}</p>
        </CardFrame>
      );
    case 'missing': {
      const invoiceBlock = describeInvoiceBlock(card.blockReason, card.unresolvedReason);
      const invoiceAudience = AUDIENCE_COPY[describeInvoiceAbsenceAudience(card.blockReason)];
      return (
        <CardFrame
          tone="warning"
          badge={copy.nothingToPrintBadge}
          slot={copy.insideLabelMissing}
          title={copy.missingTitle}
        >
          {/* F2 — named, never silently skipped, and it blocks nothing. */}
          <p>{copy.missingBody}</p>
          <h4>{copy.missingInvoiceTitle}</h4>
          <p>{copy.missingInvoiceBody}</p>
          <p className="bench-documents__missing-reason">
            {copy.missingReasonLabel}:{' '}
            {invoiceBlock === null
              ? copy.missingReasonUnknown
              : `${invoiceBlock.short} — ${invoiceBlock.detail}`}
          </p>
          {/* Whether anyone else knows — three different answers, never one
              reassuring one. See `invoice-absence-audience.ts`. */}
          <p className="bench-documents__flagged">
            <strong>{invoiceAudience.title}</strong> {invoiceAudience.body}
          </p>
        </CardFrame>
      );
    }
    case 'unknown':
      return (
        <CardFrame
          tone="neutral"
          badge={copy.unknownDocument.badge}
          slot={copy.unknownDocument.slot}
          title={copy.unknownDocument.title}
        >
          <p>{stillGoes}</p>
        </CardFrame>
      );
  }
}

/**
 * The host's neutral body for a registered receipt, by what it can be handed
 * over as: a file prints, a link opens, and nothing attached says so. Never a
 * word about paper or the box.
 */
function renderDefaultReceiptBody(
  card: Extract<BenchDocumentCard, { kind: 'receipt-made' }>,
  options: {
    readonly printReceipt: () => void;
    readonly linkUrl: string | null;
    readonly linkFailed: boolean;
    readonly retryLink: () => void;
  }
): ReactNode {
  const copy = benchParcelCopy.documents.receipt;

  if (card.handover === 'document') {
    return (
      <Button tone="secondary" onClick={options.printReceipt}>
        {copy.printAction}
      </Button>
    );
  }

  if (card.handover === 'link') {
    return (
      <>
        <p>{copy.linkBody}</p>
        {options.linkUrl !== null ? (
          <a
            className="button button--secondary"
            href={options.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.openAction}
          </a>
        ) : options.linkFailed ? (
          <p className="bench-documents__receipt-link-failed">
            {copy.linkFailed}{' '}
            <Button tone="ghost" onClick={options.retryLink}>
              {copy.retryAction}
            </Button>
          </p>
        ) : (
          // Disabled until the link arrives, so what is pressed is always a real
          // link; the status line says it is on its way, so a slow fetch never
          // reads as "nothing to open" or as a failure.
          <>
            <p className="bench-documents__receipt-link-pending" role="status">
              {copy.linkPending}
            </p>
            <Button tone="secondary" disabled>
              {copy.openAction}
            </Button>
          </>
        )}
      </>
    );
  }

  return <p>{copy.noArtefactBody}</p>;
}

