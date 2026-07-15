/**
 * KSeF Invoice Detail Section
 *
 * Per-provider `invoiceDetailSection` slot for KSeF connections (#1152, B4 + B3 + B5).
 * Rendered by the neutral `OrderInvoicePanel` and `InvoiceDetailPage` via
 * `usePlatform(connection.platformType).invoiceDetailSection` — ZERO
 * `platformType` literals here.
 *
 * Displays the KSeF-specific regulatory region using the mockup's `.slot-row` layout:
 *   - Clearance status badge (via neutral `RegulatoryStatusBadge`)
 *   - KSeF number (`clearanceReference` → fallback `providerInvoiceNumber`)
 *   - Official receipt (UPO): download + inline preview (#1234, B3), gated on
 *     `regulatoryStatus === 'accepted'`
 *   - FA(3) document: view rendered HTML inline + download source XML (#1228, B5),
 *     gated on `regulatoryStatus === 'accepted'`
 *   - Inline `.doc-preview` area for the FA(3) rendered document
 *
 * @module plugins/ksef/components
 */
import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins';
import {
  RegulatoryStatusBadge,
  regCardToneFor,
  useKsefUpoDownload,
  useKsefUpoPreview,
  useKsefFa3,
} from '../../../features/invoicing';
import { KsefFa3View } from './ksef-fa3-view';
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
import { useTranslation } from '../../../shared/i18n';

/**
 * Resolved KSeF number: prefer the authority-assigned clearance reference
 * (the 35-character KSeF number) over the provider invoice number which
 * is an internal document id assigned before clearance.
 */
function resolveKsefNumber(
  clearanceReference: string | null,
  providerInvoiceNumber: string | null,
): string | null {
  return clearanceReference ?? providerInvoiceNumber ?? null;
}

export function KsefInvoiceDetailSection({
  invoice,
  connection,
}: InvoiceDetailSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const upoDownload = useKsefUpoDownload();
  const upoPreview = useKsefUpoPreview();
  const fa3 = useKsefFa3();
  const { showToast } = useToast();
  // Tracks a fetched-but-unparseable FA(3) document so the preview area falls
  // through to placeholder/error copy instead of rendering nothing (KsefFa3View
  // returns null on parse failure) - reset on every fresh load attempt.
  const [viewParseFailed, setViewParseFailed] = useState(false);
  const handleFa3ParseError = useCallback(() => setViewParseFailed(true), []);

  const ksefNumber = resolveKsefNumber(invoice.clearanceReference, invoice.providerInvoiceNumber);
  // KSeF target environment for this connection ('test' | 'demo' | 'prod'),
  // used to pick the verification-code (QR) host (prod vs test portal). The FE
  // Connection config is untyped, so narrow defensively; absence falls back to
  // the test verification host in the lib, never prod.
  const ksefEnvironment =
    typeof connection.config.env === 'string' ? connection.config.env : undefined;
  const hasRegulatoryData = invoice.regulatoryStatus !== 'not-applicable';

  if (!hasRegulatoryData && !ksefNumber) {
    return null;
  }

  // UPO and FA(3) are available only once the authority has accepted the invoice —
  // that's the terminal success state where the UPO document and issued FA(3) exist.
  const isAccepted = invoice.regulatoryStatus === 'accepted';

  async function handlePreviewUpo(): Promise<void> {
    const ok = await upoPreview.open(invoice.id);
    if (!ok) {
      showToast({
        tone: 'error',
        title: t('invoice.ksef.upoPreviewFailed', 'UPO preview failed'),
        description:
          upoPreview.error?.message ??
          t('invoice.ksef.upoPreviewFailedDesc', 'Could not fetch the confirmation document.'),
      });
    }
  }

  async function handleDownloadUpo(): Promise<void> {
    const ok = await upoDownload.download(invoice.id);
    if (!ok) {
      showToast({
        tone: 'error',
        title: t('invoice.ksef.upoDownloadFailed', 'UPO download failed'),
        description:
          upoDownload.error?.message ??
          t('invoice.ksef.upoDownloadFailedDesc', 'Could not fetch the confirmation document.'),
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
        title: t('invoice.ksef.fa3ViewFailed', 'FA(3) preview failed'),
        description:
          err.message ?? t('invoice.ksef.fa3ViewFailedDesc', 'Could not fetch the document.'),
      });
    }
  }

  async function handleDownloadXml(): Promise<void> {
    // Same pattern: use the returned error, not the stale fa3.xmlError from closure.
    const err = await fa3.downloadXml(invoice.id);
    if (err) {
      showToast({
        tone: 'error',
        title: t('invoice.ksef.fa3XmlFailed', 'FA(3) XML download failed'),
        description:
          err.message ?? t('invoice.ksef.fa3XmlFailedDesc', 'Could not fetch the source document.'),
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
          {t('invoice.ksef.sectionTitle', 'KSeF · National e-Invoicing System')}
        </h4>

        {hasRegulatoryData ? (
          <div className="slot-row">
            <div>
              <div className="slot-row__label">
                {t('invoice.ksef.clearanceStatus', 'Clearance status')}
              </div>
            </div>
            <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
          </div>
        ) : null}

        {/* Rejection detail (#1582): when the authority rejected the document,
            surface its operator-facing diagnostic so the operator can see WHY. */}
        {invoice.regulatoryStatus === 'rejected' && invoice.clearanceDetail ? (
          <div className="slot-row">
            <div>
              <div className="slot-row__label">
                {t('invoice.ksef.rejectionDetail', 'Rejection detail')}
              </div>
              <div className="slot-row__hint">
                {t('invoice.ksef.rejectionDetailHint', 'Reported by the authority (KSeF)')}
              </div>
            </div>
            <span className="text-danger" role="status">
              {invoice.clearanceDetail}
            </span>
          </div>
        ) : null}

        <div className="slot-row">
          <div>
            <div className="slot-row__label">{t('invoice.ksef.number', 'KSeF number')}</div>
            <div className="slot-row__hint">
              {t('invoice.ksef.numberHint', 'Authority-assigned on clearance')}
            </div>
            {/* Art. 108g (transitional from 2026): a bank transfer paying a KSeF
                invoice must carry this 35-character KSeF number in the payment
                title. We surface it copyable so the operator/buyer can paste it
                into the transfer — OpenLinker does not initiate the transfer. */}
            {ksefNumber ? (
              <div className="slot-row__hint">
                {t(
                  'invoice.ksef.art108gHint',
                  'Art. 108g: include this KSeF number in the bank-transfer title when paying this invoice.',
                )}
              </div>
            ) : null}
          </div>
          {ksefNumber ? (
            <CopyableId id={ksefNumber} label={ksefNumber} />
          ) : (
            <span className="text-muted">
              {t('invoice.ksef.numberPending', 'Pending')}
            </span>
          )}
        </div>

        <div className="slot-row">
          <div>
            <div className="slot-row__label">
              {t('invoice.ksef.upoLabel', 'Official receipt (UPO)')}
            </div>
            <div className="slot-row__hint">
              {isAccepted
                ? t('invoice.ksef.upoHint', 'Proof of clearance')
                : t('invoice.ksef.upoHintPending', 'Available once cleared')}
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
                  ? t('common.loading', 'Loading…')
                  : t('invoice.ksef.upoPreview', 'Preview')}
              </Button>
              <Button
                tone="ghost"
                className="button--sm"
                onClick={() => void handleDownloadUpo()}
                disabled={upoDownload.isDownloading}
              >
                {upoDownload.isDownloading
                  ? t('invoice.ksef.upoDownloading', 'Downloading…')
                  : t('invoice.ksef.upoDownload', 'Download UPO')}
              </Button>
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </div>

        {isAccepted ? (
          <>
            <div className="slot-row">
              <div>
                <div className="slot-row__label">
                  {t('invoice.ksef.fa3Label', 'FA(3) document')}
                </div>
                <div className="slot-row__hint">
                  {t('invoice.ksef.fa3Hint', 'Human-readable + source XML')}
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
                    ? t('common.loading', 'Loading…')
                    : t('invoice.ksef.fa3View', 'View')}
                </Button>
                <Button
                  tone="ghost"
                  className="button--sm"
                  onClick={() => void handleDownloadXml()}
                  disabled={fa3.isDownloadingXml}
                >
                  {fa3.isDownloadingXml
                    ? t('invoice.ksef.fa3Downloading', 'Downloading…')
                    : t('invoice.ksef.fa3DownloadXml', 'Download XML')}
                </Button>
              </span>
            </div>

            <div className="doc-preview">
              <span className="doc-preview__chip">
                {t('invoice.ksef.fa3Preview', 'FA(3) preview')}
              </span>
              {fa3.viewError || viewParseFailed ? (
                <span>{t('invoice.ksef.fa3ViewError', "Preview failed. Click 'View' to retry.")}</span>
              ) : fa3.viewText !== null ? (
                <KsefFa3View
                  xmlText={fa3.viewText}
                  ksefNumber={ksefNumber}
                  environment={ksefEnvironment}
                  onParseError={handleFa3ParseError}
                />
              ) : (
                <span>{t('invoice.ksef.fa3PreviewPlaceholder', "Click 'View' to load the invoice.")}</span>
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
            <DialogTitle>{t('invoice.ksef.upoDialogTitle', 'UPO confirmation')}</DialogTitle>
            <DialogDescription id="ksef-upo-preview-desc">
              {t(
                'invoice.ksef.upoDialogDesc',
                'Official confirmation (UPO) for this KSeF invoice.',
              )}
            </DialogDescription>
            {upoPreviewState.kind === 'unsupported' ? (
              <p className="ksef-upo-preview__unsupported">
                {t(
                  'invoice.ksef.upoPreviewUnsupported',
                  'This confirmation can\'t be previewed inline. Use "Download UPO" to open it.',
                )}
              </p>
            ) : (
              <iframe
                className="ksef-upo-preview__frame"
                src={upoPreviewState.objectUrl}
                title={t('invoice.ksef.upoFrameTitle', 'UPO confirmation preview')}
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
                    ? t('invoice.ksef.upoDownloading', 'Downloading…')
                    : t('invoice.ksef.upoDownload', 'Download UPO')}
                </Button>
              ) : null}
              <DialogClose asChild>
                <Button tone="secondary" className="button--sm">
                  {t('common.close', 'Close')}
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
