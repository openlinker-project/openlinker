/**
 * Infakt Invoice Detail Section
 *
 * Per-provider `invoiceDetailSection` slot for inFakt connections (#1282).
 * inFakt submits invoices to KSeF on OpenLinker's behalf and reports back
 * clearance status — OpenLinker only reads the neutral `regulatoryStatus`,
 * it never talks to KSeF directly for this provider. inFakt exposes no
 * UPO/FA3 document endpoints of its own, but it does render a PDF of the
 * invoice server-side (#1321) — the "Download PDF" action below hits the
 * neutral `RegulatoryDocumentReader`-backed `/document?kind=rendered` route.
 *
 * Uses the shared `.reg-card` severity-stripe treatment (#1282) directly —
 * inFakt ships with the redesigned look from day one.
 *
 * @module plugins/infakt/components
 */
import type { ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins/plugin.types';
import {
  RegulatoryStatusBadge,
  regCardToneFor,
  useInvoiceRenderedDocumentDownload,
} from '../../../features/invoicing';

export function InfaktInvoiceDetailSection({
  invoice,
}: InvoiceDetailSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const pdfDownload = useInvoiceRenderedDocumentDownload();
  const { showToast } = useToast();

  if (invoice.regulatoryStatus === 'not-applicable') {
    return null;
  }

  const ksefNumber = invoice.clearanceReference ?? invoice.providerInvoiceNumber ?? null;

  async function handleDownloadPdf(): Promise<void> {
    const ok = await pdfDownload.download(invoice.id);
    if (!ok) {
      showToast({
        tone: 'error',
        title: t('infakt.invoice.detail.pdfDownloadFailed', 'PDF download failed'),
        description:
          pdfDownload.error?.message ??
          t('infakt.invoice.detail.pdfDownloadFailedDesc', 'Could not fetch the invoice PDF.'),
      });
    }
  }

  return (
    <section className={`invoice-detail-section reg-card ${regCardToneFor(invoice.regulatoryStatus)}`.trim()}>
      <div className="reg-card__header">
        <h4 className="invoice-detail-section__title">
          {t('infakt.invoice.detail.title', 'KSeF clearance (via inFakt)')}
        </h4>
        <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
      </div>

      {invoice.regulatoryStatus === 'submitted' ? (
        <>
          <p className="text-muted reg-card__note">
            {t(
              'infakt.invoice.detail.pending',
              'inFakt is submitting this invoice to KSeF. Clearance usually completes within a minute or two.',
            )}
          </p>
          <div className="reg-card__progress" aria-hidden="true" />
        </>
      ) : null}

      {invoice.regulatoryStatus === 'accepted' ? (
        <div className="reg-card__summary">
          {ksefNumber ? (
            <CopyableId id={ksefNumber} label={ksefNumber} />
          ) : (
            <span className="text-muted">
              {t('infakt.invoice.detail.numberPending', 'KSeF number pending')}
            </span>
          )}
          <Button
            tone="ghost"
            className="button--sm"
            onClick={() => void handleDownloadPdf()}
            disabled={pdfDownload.isDownloading}
          >
            {pdfDownload.isDownloading
              ? t('infakt.invoice.detail.pdfDownloading', 'Downloading…')
              : t('infakt.invoice.detail.pdfDownload', 'Download PDF')}
          </Button>
        </div>
      ) : null}

      {invoice.regulatoryStatus === 'rejected' ? (
        <p className="text-muted reg-card__note">
          {invoice.failureReason ??
            t('infakt.invoice.detail.rejectedFallback', 'KSeF rejected this invoice.')}
        </p>
      ) : null}
    </section>
  );
}
