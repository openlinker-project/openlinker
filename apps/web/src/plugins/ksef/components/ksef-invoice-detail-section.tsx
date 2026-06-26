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
import type { ReactElement } from 'react';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins';
import {
  RegulatoryStatusBadge,
  useKsefUpoDownload,
  useKsefUpoPreview,
  useKsefFa3,
} from '../../../features/invoicing';
import { Button } from '../../../shared/ui/button';
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
}: InvoiceDetailSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const upoDownload = useKsefUpoDownload();
  const upoPreview = useKsefUpoPreview();
  const fa3 = useKsefFa3();
  const { showToast } = useToast();

  const ksefNumber = resolveKsefNumber(invoice.clearanceReference, invoice.providerInvoiceNumber);
  const hasRegulatoryData = invoice.regulatoryStatus !== 'not-applicable';

  if (!hasRegulatoryData && !ksefNumber) {
    return null;
  }

  // UPO and FA(3) are available only once the authority has accepted the invoice —
  // that's the terminal success state where the UPO document and issued FA(3) exist.
  const canUseUpo = invoice.regulatoryStatus === 'accepted';

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
    await fa3.loadView(invoice.id);
    if (fa3.viewError) {
      showToast({
        tone: 'error',
        title: t('invoice.ksef.fa3ViewFailed', 'FA(3) preview failed'),
        description:
          fa3.viewError.message ??
          t('invoice.ksef.fa3ViewFailedDesc', 'Could not fetch the document.'),
      });
    }
  }

  async function handleDownloadXml(): Promise<void> {
    await fa3.downloadXml(invoice.id);
    if (fa3.xmlError) {
      showToast({
        tone: 'error',
        title: t('invoice.ksef.fa3XmlFailed', 'FA(3) XML download failed'),
        description:
          fa3.xmlError.message ?? t('invoice.ksef.fa3XmlFailedDesc', 'Could not fetch the source document.'),
      });
    }
  }

  const upoPreviewState = upoPreview.preview;

  return (
    <>
      <section className="invoice-detail-section invoice-detail-section--ksef">
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

        <div className="slot-row">
          <div>
            <div className="slot-row__label">{t('invoice.ksef.number', 'KSeF number')}</div>
            <div className="slot-row__hint">
              {t('invoice.ksef.numberHint', 'Authority-assigned on clearance')}
            </div>
          </div>
          {ksefNumber ? (
            <span className="mono-text text-sm">{ksefNumber}</span>
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
              {canUseUpo
                ? t('invoice.ksef.upoHint', 'Proof of clearance')
                : t('invoice.ksef.upoHintPending', 'Available once cleared')}
            </div>
          </div>
          {canUseUpo ? (
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

        {canUseUpo ? (
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
              {fa3.viewError ? (
                <span>{t('invoice.ksef.fa3ViewError', "Preview failed. Click 'View' to retry.")}</span>
              ) : fa3.viewObjectUrl ? (
                <iframe
                  className="doc-preview__frame"
                  src={fa3.viewObjectUrl}
                  title={t('invoice.ksef.fa3FrameTitle', 'FA(3) document preview')}
                  // blob: URL inherits the app origin, so framing it without restrictions
                  // would allow scripts from the invoice document to run with app privileges.
                  // sandbox="" blocks all scripts while still rendering the document.
                  sandbox=""
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
                sandbox=""
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
