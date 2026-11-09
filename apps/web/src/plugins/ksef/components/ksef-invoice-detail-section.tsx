/**
 * KSeF Invoice Detail Section
 *
 * Per-provider `invoiceDetailSection` slot for KSeF connections (#1152, B4 + B3 + B5).
 * Rendered by the neutral `SalesDocumentPanel` (#2160, `orders` feature) and
 * `InvoiceDetailPage` via
 * `usePlatform(connection.platformType).invoiceDetailSection` — ZERO
 * `platformType` literals here.
 *
 * Displays the KSeF-specific regulatory region using the mockup's `.slot-row` layout:
 *   - Clearance status badge (the shared, regulator-neutral
 *     `RegulatoryStatusBadge`, branded with the KSeF-specific
 *     `labelOverrides` — #3181, since this surface is KSeF's own)
 *   - KSeF number: the authority's `clearanceReference` ONLY (DEF-14). OL's own
 *     document number gets its own row - before clearance there is no KSeF
 *     number, and the Art. 108g copy hint must never offer one.
 *   - Official receipt (UPO): download + inline preview (#1234, B3), gated on
 *     `regulatoryStatus === 'accepted'`
 *   - FA(3) document: view rendered HTML inline + download source XML (#1228, B5),
 *     gated on `regulatoryStatus === 'accepted'`
 *   - Inline `.doc-preview` area for the FA(3) rendered document
 *   - While the document waits for its KSeF number, a dashed placeholder where
 *     the KOD I verification QR will appear (#3547, M24 `not-cleared`)
 *
 * @module plugins/ksef/components
 */
import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins';
import {
  RegulatoryStatusBadge,
  regCardToneFor,
  useRegulatoryConfirmationDownload,
  useRegulatoryConfirmationPreview,
  useInvoiceSourceDocument,
  useInvoiceVerificationLinkQuery,
} from '../../../features/invoicing';
import type { RegulatoryStatus } from '../../../features/invoicing';
import { KsefFa3View } from './ksef-fa3-view';
import { getKsefRegulatoryStatusLabels } from '../lib/ksef-regulatory-status-labels';
import { Button } from '../../../shared/ui/button';
import { CopyableId } from '../../../shared/ui/copyable-id';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { useToast } from '../../../shared/ui/toast-provider';
import { useKsefMessages } from '../messages';

/**
 * Clearance statuses in which a document is still waiting for its KSeF number,
 * so the KOD I QR cannot exist yet (#3547). `cleared` is listed for safety: no
 * KSeF path emits it today, and it is not the terminal `accepted`. If a
 * provider-neutral `cleared` ever starts meaning "has its number", remove it
 * here, or this section will show the placeholder for a document that has one.
 */
const AWAITING_KSEF_NUMBER_STATUSES: ReadonlyArray<RegulatoryStatus> = [
  'pending-submission',
  'submitted',
  'cleared',
];

export function KsefInvoiceDetailSection({
  invoice,
}: InvoiceDetailSectionProps): ReactElement | null {
  const copy = useKsefMessages().ksefInvoiceDetailSection;
  const upoDownload = useRegulatoryConfirmationDownload();
  const upoPreview = useRegulatoryConfirmationPreview();
  const fa3 = useInvoiceSourceDocument();
  const { showToast } = useToast();
  // Tracks a fetched-but-unparseable FA(3) document so the preview area falls
  // through to placeholder/error copy instead of rendering nothing (KsefFa3View
  // returns null on parse failure) - reset on every fresh load attempt.
  const [viewParseFailed, setViewParseFailed] = useState(false);
  const handleFa3ParseError = useCallback(() => setViewParseFailed(true), []);

  // DEF-14: the KSeF number is the authority's, and exists only once cleared.
  const ksefNumber = invoice.clearanceReference;
  const documentNumber = invoice.providerInvoiceNumber;
  const hasRegulatoryData = invoice.regulatoryStatus !== 'not-applicable';
  // UPO and FA(3) are available only once the authority has accepted the invoice —
  // that's the terminal success state where the UPO document and issued FA(3) exist.
  const isAccepted = invoice.regulatoryStatus === 'accepted';
  // #3547: KOD I exists only once KSeF has assigned the number. Until then the
  // operator sees why the QR is missing instead of an empty space. `rejected`
  // is deliberately absent: such a document never gets a KSeF number, and the
  // rejection detail above already says what happened.
  const isAwaitingKsefNumber = AWAITING_KSEF_NUMBER_STATUSES.includes(invoice.regulatoryStatus);
  // DEF-02 / DEF-03 / DEF-15: the QR link is built by the server from the
  // submitted document, so it is right for every role and needs no browser crypto.
  const verificationLink = useInvoiceVerificationLinkQuery(invoice.id, isAccepted);

  if (!hasRegulatoryData && !ksefNumber) {
    return null;
  }

  async function handlePreviewUpo(): Promise<void> {
    const ok = await upoPreview.open(invoice.id);
    if (!ok) {
      showToast({
        tone: 'error',
        title: copy.upoPreviewFailed,
        description:
          upoPreview.error?.message ??
          copy.upoPreviewFailedDesc,
      });
    }
  }

  async function handleDownloadUpo(): Promise<void> {
    const ok = await upoDownload.download(invoice.id);
    if (!ok) {
      showToast({
        tone: 'error',
        title: copy.upoDownloadFailed,
        description:
          upoDownload.error?.message ??
          copy.upoDownloadFailedDesc,
      });
    }
  }

  async function handleViewFa3(): Promise<void> {
    setViewParseFailed(false);
    // Use the returned error rather than reading fa3.viewError from the closure —
    // that would be stale (React state hasn't re-rendered yet after the await).
    const err = await fa3.loadView(invoice.id);
    if (err) {
      showToast({
        tone: 'error',
        title: copy.fa3ViewFailed,
        description:
          err.message ?? copy.fa3ViewFailedDesc,
      });
    }
  }

  async function handleDownloadXml(): Promise<void> {
    // Same pattern: use the returned error, not the stale fa3.xmlError from closure.
    const err = await fa3.downloadXml(invoice.id);
    if (err) {
      showToast({
        tone: 'error',
        title: copy.fa3XmlFailed,
        description:
          err.message ?? copy.fa3XmlFailedDesc,
      });
    }
  }

  const upoPreviewState = upoPreview.preview;

  return (
    <>
      <section
        className={`invoice-detail-section invoice-detail-section--ksef reg-card ${regCardToneFor(
          invoice.regulatoryStatus,
        )}`.trim()}
      >
        <h4 className="invoice-detail-section__title">
          {copy.sectionTitle}
        </h4>

        {hasRegulatoryData ? (
          <div className="slot-row">
            <div>
              <div className="slot-row__label">
                {copy.clearanceStatus}
              </div>
            </div>
            <RegulatoryStatusBadge
              status={invoice.regulatoryStatus}
              labelOverrides={getKsefRegulatoryStatusLabels()}
            />
          </div>
        ) : null}

        {/* Rejection detail (#1582): when the authority rejected the document,
            surface its operator-facing diagnostic so the operator can see WHY. */}
        {invoice.regulatoryStatus === 'rejected' && invoice.clearanceDetail ? (
          <div className="slot-row">
            <div>
              <div className="slot-row__label">
                {copy.rejectionDetail}
              </div>
              <div className="slot-row__hint">
                {copy.rejectionDetailHint}
              </div>
            </div>
            <span className="text-danger" role="status">
              {invoice.clearanceDetail}
            </span>
          </div>
        ) : null}

        {documentNumber ? (
          <div className="slot-row">
            <div>
              <div className="slot-row__label">
                {copy.documentNumber}
              </div>
              <div className="slot-row__hint">
                {copy.documentNumberHint}
              </div>
            </div>
            <span className="mono-text">{documentNumber}</span>
          </div>
        ) : null}

        <div className="slot-row">
          <div>
            <div className="slot-row__label">{copy.number}</div>
            <div className="slot-row__hint">
              {copy.numberHint}
            </div>
            {/* Art. 108g (transitional from 2026): a bank transfer paying a KSeF
                invoice must carry this 35-character KSeF number in the payment
                title. We surface it copyable so the operator/buyer can paste it
                into the transfer — OpenLinker does not initiate the transfer. */}
            {ksefNumber ? (
              <div className="slot-row__hint">
                {copy.art108gHint}
              </div>
            ) : null}
          </div>
          {ksefNumber ? (
            <CopyableId id={ksefNumber} label={ksefNumber} />
          ) : (
            <span className="text-muted">
              {copy.numberPending}
            </span>
          )}
        </div>

        <div className="slot-row">
          <div>
            <div className="slot-row__label">
              {copy.upoLabel}
            </div>
            <div className="slot-row__hint">
              {isAccepted
                ? copy.upoHint
                : copy.upoHintPending}
            </div>
          </div>
          {isAccepted ? (
            <span className="slot-row__actions">
              <Button
                tone="ghost"
                className="button--sm"
                onClick={() => void handlePreviewUpo()}
                disabled={upoPreview.isLoading}
              >
                {upoPreview.isLoading
                  ? copy.loading
                  : copy.upoPreview}
              </Button>
              <Button
                tone="ghost"
                className="button--sm"
                onClick={() => void handleDownloadUpo()}
                disabled={upoDownload.isDownloading}
              >
                {upoDownload.isDownloading
                  ? copy.upoDownloading
                  : copy.upoDownload}
              </Button>
            </span>
          ) : (
            <span className="text-muted">{copy.emptyCell}</span>
          )}
        </div>

        {isAwaitingKsefNumber ? (
          // M24 `not-cleared`: a dashed frame where the KOD I QR will be, beside
          // the reason it is not there yet. The copy states only what OpenLinker
          // actually does: a `submitted` status is re-checked in the background
          // (`regulatory-status-reconcile`, on by default), but the offline-window
          // resubmit for `pending-submission` is opt-in, so that copy promises no
          // automatic send.
          <div className="ksef-verification-pending" role="note">
            <div className="ksef-verification-pending__frame">
              {copy.verificationPendingFrame}
            </div>
            <div className="ksef-verification-pending__text">
              <strong>
                {copy.verificationPendingLabel}
              </strong>
              <span>
                {invoice.regulatoryStatus === 'pending-submission'
                  ? copy.verificationPendingNotSent
                  : copy.verificationPendingHint}
              </span>
            </div>
          </div>
        ) : null}

        {isAccepted ? (
          <>
            <div className="slot-row">
              <div>
                <div className="slot-row__label">
                  {copy.fa3Label}
                </div>
                <div className="slot-row__hint">
                  {copy.fa3Hint}
                </div>
              </div>
              <span className="slot-row__actions">
                <Button
                  tone="ghost"
                  className="button--sm"
                  onClick={() => void handleViewFa3()}
                  disabled={fa3.isLoadingView}
                >
                  {fa3.isLoadingView
                    ? copy.loading
                    : copy.fa3View}
                </Button>
                <Button
                  tone="ghost"
                  className="button--sm"
                  onClick={() => void handleDownloadXml()}
                  disabled={fa3.isDownloadingXml}
                >
                  {fa3.isDownloadingXml
                    ? copy.fa3Downloading
                    : copy.fa3DownloadXml}
                </Button>
              </span>
            </div>

            <div className="doc-preview">
              <span className="doc-preview__chip">
                {copy.fa3Preview}
              </span>
              {fa3.viewError || viewParseFailed ? (
                <span>{copy.fa3ViewError}</span>
              ) : fa3.viewText !== null ? (
                <KsefFa3View
                  xmlText={fa3.viewText}
                  ksefNumber={ksefNumber}
                  verificationUrl={verificationLink.data?.url ?? null}
                  onParseError={handleFa3ParseError}
                />
              ) : (
                <span>{copy.fa3PreviewPlaceholder}</span>
              )}
            </div>
          </>
        ) : null}
      </section>

      {/* UPO inline preview dialog */}
      <Dialog
        open={upoPreviewState !== null}
        onOpenChange={(next) => {
          if (!next) upoPreview.close();
        }}
      >
        {upoPreviewState !== null ? (
          <DialogContent className="dialog__content--wide" aria-describedby="ksef-upo-preview-desc">
            <DialogTitle>{copy.upoDialogTitle}</DialogTitle>
            <DialogDescription id="ksef-upo-preview-desc">
              {copy.upoDialogDesc}
            </DialogDescription>
            {upoPreviewState.kind === 'unsupported' ? (
              <p className="ksef-upo-preview__unsupported">
                {copy.upoPreviewUnsupported}
              </p>
            ) : (
              <iframe
                className="ksef-upo-preview__frame"
                src={upoPreviewState.objectUrl}
                title={copy.upoFrameTitle}
                // `allow-same-origin` is required for the browser's built-in PDF renderer
                // (Chrome/Firefox) to display a blob: URL for PDF content. Without it
                // sandbox="" blocks the PDF plugin and the frame renders blank.
                // Scripts are still blocked — only `allow-same-origin` is granted.
                sandbox={upoPreviewState.kind === 'pdf' ? 'allow-same-origin' : ''}
              />
            )}
            <DialogFooter>
              {upoPreviewState.kind === 'unsupported' ? (
                <Button
                  tone="secondary"
                  className="button--sm"
                  onClick={() => void handleDownloadUpo()}
                  disabled={upoDownload.isDownloading}
                >
                  {upoDownload.isDownloading
                    ? copy.upoDownloading
                    : copy.upoDownload}
                </Button>
              ) : null}
              <DialogClose asChild>
                <Button tone="secondary" className="button--sm">
                  {copy.close}
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
