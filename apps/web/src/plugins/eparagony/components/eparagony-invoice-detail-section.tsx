/**
 * EparagonyInvoiceDetailSection (#3192)
 *
 * Per-provider `invoiceDetailSection` slot for eparagony connections, in the
 * shape `KsefInvoiceDetailSection` / `InfaktInvoiceDetailSection` /
 * `SubiektInvoiceDetailSection` already take: content-only, resolved by the
 * host through `usePlatform(connection.platformType)`, with the host owning
 * the card chrome and the capability gate. No `platformType` literal appears
 * outside this folder.
 *
 * It carries the two facts only this provider's adapter knows, and nothing
 * the neutral surfaces already say:
 *
 *  1. **`clearance-cannot-retry`** - while the document waits, OpenLinker
 *     cannot move it on. The provider publishes no call that triggers or
 *     re-triggers transmission, so there is no operation to offer. **No retry
 *     control accompanies this region, by design**: a button that cannot
 *     reach anything is worse than the absence it replaces, because an
 *     operator who presses it concludes the push happened. The spec beside
 *     this file asserts the section renders no button at all.
 *  2. **`sales-document-open-visualisation`** - a link to the issued document.
 *     This provider publishes an HTML **visualisation**, not a PDF, so the
 *     affordance says so rather than promising a file: the shared
 *     `InvoicePdfLink` the host renders in its Number row is named for the
 *     common case, and repeating that name here would misdescribe what opens.
 *
 * `pdfUrl` reaches the frontend adapter-controlled with no server-side scheme
 * validation, so it goes through `isSafeHttpUrl` before becoming an `href` -
 * the `InvoicePdfLink` rule, restated because this is a second anchor over the
 * same untrusted field.
 *
 * Deliberately absent: a clearance badge. The host already renders one in its
 * Clearance row, on every surface this slot mounts into, and a second copy
 * would be two renderings of one fact that can disagree after a refetch.
 *
 * @module plugins/eparagony/components
 */
import type { ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { isSafeHttpUrl } from '../../../shared/lib/is-safe-http-url';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins';
import { regCardToneFor } from '../../../features/invoicing';

export function EparagonyInvoiceDetailSection({
  invoice,
}: InvoiceDetailSectionProps): ReactElement | null {
  const { t } = useTranslation();

  // The issued document, legally effective from issuance rather than from
  // clearance for this provider, so the link is offered in the waiting state
  // too and is not gated on a terminal clearance value.
  const visualisationUrl =
    invoice.pdfUrl && isSafeHttpUrl(invoice.pdfUrl) ? invoice.pdfUrl : null;
  const awaitingSubmission = invoice.regulatoryStatus === 'pending-submission';
  const tone = regCardToneFor(invoice.regulatoryStatus);

  if (!awaitingSubmission && visualisationUrl === null) return null;

  return (
    <section className={`invoice-detail-section reg-card ${tone}`.trim()}>
      <h4 className="invoice-detail-section__title">
        {t('eparagony.invoice.detail.title', 'Provider document')}
      </h4>

      {awaitingSubmission ? (
        <Alert
          tone="info"
          data-testid="clearance-cannot-retry"
          title={t(
            'eparagony.invoice.detail.cannotRetryTitle',
            'Waiting on the provider - OpenLinker cannot push this',
          )}
        >
          {t(
            'eparagony.invoice.detail.cannotRetryBody',
            "The provider's API has no call that triggers or re-triggers submission. " +
              'The document is with them, and only they can move it on.',
          )}
        </Alert>
      ) : null}

      {visualisationUrl !== null ? (
        <>
          <div className="reg-card__summary">
            <span>{t('eparagony.invoice.detail.visualisation', 'Invoice visualisation')}</span>
            <a
              href={visualisationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="link"
              data-testid="sales-document-open-visualisation"
              // Names what opens, because "Open" alone is meaningless in a
              // screen reader's link list, and names the VISUALISATION so
              // the accessible name does not promise a PDF either.
              aria-label={t(
                'eparagony.invoice.detail.visualisationAria',
                'Open the invoice visualisation (opens in a new tab)',
              )}
            >
              {t('eparagony.invoice.detail.open', 'Open')}
            </a>
          </div>
          <p className="text-muted reg-card__note">
            {t(
              'eparagony.invoice.detail.visualisationNote',
              'An HTML view published by the provider, not a PDF.',
            )}
          </p>
        </>
      ) : null}
    </section>
  );
}
