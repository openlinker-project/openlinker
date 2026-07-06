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
  useResendToKsefMutation,
} from '../../../features/invoicing';

export function InfaktInvoiceDetailSection({
  invoice,
}: InvoiceDetailSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const pdfDownload = useInvoiceRenderedDocumentDownload();
  const resendToKsef = useResendToKsefMutation();
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

  async function handleResendToKsef(): Promise<void> {
    try {
      await resendToKsef.mutateAsync(invoice.id);
      showToast({
        tone: 'success',
        title: t('infakt.invoice.detail.resendSuccess', 'Re-sent to KSeF'),
        description: t(
          'infakt.invoice.detail.resendSuccessDesc',
          'inFakt is submitting this invoice to KSeF again. Its clearance status will refresh shortly.',
        ),
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: t('infakt.invoice.detail.resendFailed', 'Re-send failed'),
        description:
          (error instanceof Error ? error.message : undefined) ??
          t('infakt.invoice.detail.resendFailedDesc', 'Could not re-send the invoice to KSeF.'),
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
        <div className="reg-card__summary">
          <p className="text-muted reg-card__note">
            {invoice.failureReason ??
              t('infakt.invoice.detail.rejectedFallback', 'KSeF rejected this invoice.')}
          </p>
          <Button
            tone="primary"
            className="button--sm"
            onClick={() => void handleResendToKsef()}
            disabled={resendToKsef.isPending}
          >
            {resendToKsef.isPending
              ? t('infakt.invoice.detail.resending', 'Re-sending…')
              : t('infakt.invoice.detail.resend', 'Resend to KSeF')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
