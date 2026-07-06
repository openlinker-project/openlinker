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
import { useState, type ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins/plugin.types';
import {
  RegulatoryStatusBadge,
  regCardToneFor,
  useInvoiceRenderedDocumentDownload,
  useSendInvoiceEmailMutation,
  type InvoiceEmailLocale,
} from '../../../features/invoicing';

export function InfaktInvoiceDetailSection({
  invoice,
}: InvoiceDetailSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const pdfDownload = useInvoiceRenderedDocumentDownload();
  const sendEmail = useSendInvoiceEmailMutation();
  const [emailLocale, setEmailLocale] = useState<InvoiceEmailLocale>('pl');
  const { showToast } = useToast();

  if (invoice.regulatoryStatus === 'not-applicable') {
    return null;
  }

  const ksefNumber = invoice.clearanceReference ?? invoice.providerInvoiceNumber ?? null;
  const canSendEmail = invoice.status === 'issued';

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

  async function handleSendEmail(): Promise<void> {
    try {
      await sendEmail.mutateAsync({ invoiceId: invoice.id, input: { locale: emailLocale } });
      showToast({
        tone: 'success',
        title: t('infakt.invoice.detail.emailSent', 'Invoice emailed to buyer'),
        description: t(
          'infakt.invoice.detail.emailSentDesc',
          'inFakt is delivering the invoice to the buyer by email.',
        ),
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: t('infakt.invoice.detail.emailFailed', 'Sending email failed'),
        description:
          error instanceof Error
            ? error.message
            : t('infakt.invoice.detail.emailFailedDesc', 'Could not email the invoice to the buyer.'),
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

      {canSendEmail ? (
        <div className="reg-card__actions invoice-detail-section__email">
          <label className="invoice-detail-section__email-locale">
            <span className="text-muted">
              {t('infakt.invoice.detail.emailLanguage', 'Email language')}
            </span>
            <Select
              value={emailLocale}
              disabled={sendEmail.isPending}
              onChange={(e) => setEmailLocale(e.target.value as InvoiceEmailLocale)}
            >
              <option value="pl">{t('infakt.invoice.detail.emailLocalePl', 'Polish')}</option>
              <option value="en">{t('infakt.invoice.detail.emailLocaleEn', 'English')}</option>
            </Select>
          </label>
          <Button
            tone="primary"
            className="button--sm"
            onClick={() => void handleSendEmail()}
            disabled={sendEmail.isPending}
          >
            {sendEmail.isPending
              ? t('infakt.invoice.detail.emailSending', 'Sending…')
              : t('infakt.invoice.detail.emailSend', 'Send by email')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
