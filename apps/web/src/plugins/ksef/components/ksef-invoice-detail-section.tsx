/**
 * KSeF Invoice Detail Section
 *
 * Per-provider `invoiceDetailSection` slot for KSeF connections (#1152, B4 + B3/B5).
 * Rendered by the neutral `OrderInvoicePanel` and `InvoiceDetailPage` via
 * `usePlatform(connection.platformType).invoiceDetailSection` — ZERO
 * `platformType` literals here.
 *
 * Displays the KSeF-specific regulatory region:
 *   - KSeF clearance status via the neutral `RegulatoryStatusBadge`
 *   - The authority-assigned KSeF number (`clearanceReference`), falling back
 *     to the provider invoice number (`providerInvoiceNumber`) when the
 *     clearance reference is not yet populated.
 *   - UPO preview (sandboxed iframe) + download actions (#1234, B3/B5), gated
 *     on `regulatoryStatus === 'accepted'` (the UPO exists only once the
 *     authority has accepted the invoice).
 *
 * FA(3) visualization: deferred — the UPO document itself (PDF or XML) is the
 * KSeF-issued confirmation; a human-readable FA(3) rendering is tracked as a
 * follow-up (#1228).
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins';
import { RegulatoryStatusBadge, useKsefUpoDownload, useKsefUpoPreview } from '../../../features/invoicing';
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
  const { showToast } = useToast();

  const ksefNumber = resolveKsefNumber(invoice.clearanceReference, invoice.providerInvoiceNumber);
  const hasRegulatoryData = invoice.regulatoryStatus !== 'not-applicable';

  // Nothing to show when there's no KSeF clearance data yet.
  if (!hasRegulatoryData && !ksefNumber) {
    return null;
  }

  // UPO actions are available only once the authority has accepted the invoice —
  // that's the terminal success state where the UPO document actually exists.
  // Gate uses the neutral status field; no platform-type comparison.
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

  const preview = upoPreview.preview;

  return (
    <>
      <section className="invoice-detail-section invoice-detail-section--ksef">
        <h4 className="invoice-detail-section__title">
          {t('invoice.ksef.sectionTitle', 'KSeF · National e-Invoicing System')}
        </h4>
        <dl className="invoice-detail-section__kv">
          {hasRegulatoryData ? (
            <>
              <dt>{t('invoice.ksef.clearanceStatus', 'Clearance status')}</dt>
              <dd>
                <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
              </dd>
            </>
          ) : null}
          {ksefNumber ? (
            <>
              <dt>{t('invoice.ksef.number', 'KSeF number')}</dt>
              <dd className="mono-text">{ksefNumber}</dd>
            </>
          ) : null}
        </dl>
        {canUseUpo ? (
          <div className="form-actions">
            <Button
              tone="secondary"
              className="button--sm"
              onClick={() => void handlePreviewUpo()}
              disabled={upoPreview.isLoading}
            >
              {upoPreview.isLoading
                ? t('invoice.ksef.upoPreviewLoading', 'Loading…')
                : t('invoice.ksef.upoPreview', 'Preview UPO')}
            </Button>
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
          </div>
        ) : null}
      </section>

      <Dialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) upoPreview.close();
        }}
      >
        {preview !== null ? (
          <DialogContent className="dialog__content--wide" aria-describedby="ksef-upo-preview-desc">
            <DialogTitle>{t('invoice.ksef.upoDialogTitle', 'UPO confirmation')}</DialogTitle>
            <DialogDescription id="ksef-upo-preview-desc">
              {t(
                'invoice.ksef.upoDialogDesc',
                'Official confirmation (UPO) for this KSeF invoice.',
              )}
            </DialogDescription>
            {preview.kind === 'unsupported' ? (
              <p className="ksef-upo-preview__unsupported">
                {t(
                  'invoice.ksef.upoPreviewUnsupported',
                  'This confirmation can’t be previewed inline. Use “Download UPO” to open it.',
                )}
              </p>
            ) : (
              <iframe
                className="ksef-upo-preview__frame"
                src={preview.objectUrl}
                title={t('invoice.ksef.upoFrameTitle', 'UPO confirmation preview')}
                // A `blob:` URL inherits the creating document's origin, so framed
                // content would otherwise run with full app-origin privileges.
                // An empty `sandbox` blocks scripts while still rendering the
                // document (browsers display blob: PDFs/XML fine under it).
                sandbox=""
              />
            )}
            <DialogFooter>
              {preview.kind === 'unsupported' ? (
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
