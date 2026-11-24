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
 * The "Send by email" control is no longer here (#3551): it is neutral and
 * lives in the host's sales-document panel for every provider.
 *
 * @module plugins/infakt/components
 */
import type { ReactElement } from 'react';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins/plugin.types';
import {
  RegulatoryStatusBadge,
  regCardToneFor,
  useInvoiceRenderedDocumentDownload,
  useResendToAuthorityMutation,
} from '../../../features/invoicing';
import { useInfaktMessages } from '../messages';
import { describeApiError } from '../../../shared/api/describe-api-error';

export function InfaktInvoiceDetailSection({
  invoice,
}: InvoiceDetailSectionProps): ReactElement | null {
  const copy = useInfaktMessages().infaktInvoiceDetailSection;
  const pdfDownload = useInvoiceRenderedDocumentDownload();
  const resendToAuthority = useResendToAuthorityMutation();
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
        title: copy.pdfDownloadFailed,
        description: pdfDownload.error
          ? describeApiError(pdfDownload.error, 'infakt')
          : copy.pdfDownloadFailedDesc,
      });
    }
  }

  async function handleResendToKsef(): Promise<void> {
    try {
      await resendToAuthority.mutateAsync(invoice.id);
      showToast({
        tone: 'success',
        title: copy.resendSuccess,
        description: copy.resendSuccessDesc,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.resendFailed,
        description: describeApiError(error, 'infakt'),
      });
    }
  }

  return (
    <section className={`invoice-detail-section reg-card ${regCardToneFor(invoice.regulatoryStatus)}`.trim()}>
      <div className="reg-card__header">
        <h4 className="invoice-detail-section__title">
          {copy.title}
        </h4>
        <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
      </div>

      {invoice.regulatoryStatus === 'submitted' ? (
        <>
          <p className="text-muted reg-card__note">
            {copy.pending}
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
              {copy.numberPending}
            </span>
          )}
          <Button
            tone="ghost"
            className="button--sm"
            onClick={() => void handleDownloadPdf()}
            disabled={pdfDownload.isDownloading}
          >
            {pdfDownload.isDownloading
              ? copy.pdfDownloading
              : copy.pdfDownload}
          </Button>
        </div>
      ) : null}

      {invoice.regulatoryStatus === 'rejected' ? (
        <div className="reg-card__summary">
          <p className="text-muted reg-card__note">
            {invoice.failureReason ??
              copy.rejectedFallback}
          </p>
          <Button
            tone="primary"
            className="button--sm"
            onClick={() => void handleResendToKsef()}
            disabled={resendToAuthority.isPending}
          >
            {resendToAuthority.isPending
              ? copy.resending
              : copy.resend}
          </Button>
        </div>
      ) : null}

    </section>
  );
}
