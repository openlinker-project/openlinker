/**
 * SendDocumentEmail (#3551)
 *
 * One neutral "Email to buyer" card for every issued sales document - an
 * invoice from any provider or a fiscal receipt. Which provider delivers is the
 * server's decision and is reported back ("Sent via"), so no platform type is
 * read here. Admin-only because both routes are `@Roles('admin')`. A manual
 * send never depends on the connection's automatic buyer-email setting (D6).
 *
 * A refusal renders the server's own sentence verbatim; the closed `code` is
 * only used to pick the tone, never to rewrite what the operator reads.
 *
 * The header reports the LAST attempt for this document from the same history
 * the Activity timeline reads. A failed read shows no status rather than "Not
 * sent yet", which would be a claim about a history we could not load.
 *
 * @module apps/web/src/features/orders/components
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import { formatDateTime } from '../../../shared/format/format-date';
import { useTranslation } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { useToast } from '../../../shared/ui/toast-provider';
import { useSendInvoiceEmailMutation } from '../../invoicing';
import { useSendReceiptEmailMutation } from '../../fiscalization';
import { useOrderDocumentEmailsQuery } from '../hooks/use-order-document-emails-query';
import type { OrderDocumentEmailEntry } from '../api/orders.types';

type EmailLocale = 'pl' | 'en';
type SentVia = 'provider' | 'openlinker';

interface SendDocumentEmailProps {
  kind: 'invoice' | 'fiscal-receipt';
  documentId: string;
  internalOrderId: string;
  /**
   * Why the document cannot be emailed yet (e.g. the tax authority has not
   * confirmed it). Set, the card explains it and offers no send.
   */
  notReadyReason?: string | null;
}

function MailIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="document-email__icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function lastAttemptFor(
  entries: readonly OrderDocumentEmailEntry[],
  documentId: string,
): OrderDocumentEmailEntry | null {
  let last: OrderDocumentEmailEntry | null = null;
  for (const entry of entries) {
    if (entry.documentId !== documentId) continue;
    if (last === null || entry.createdAt > last.createdAt) last = entry;
  }
  return last;
}

export function SendDocumentEmail({
  kind,
  documentId,
  internalOrderId,
  notReadyReason = null,
}: SendDocumentEmailProps): ReactElement | null {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const invoiceMutation = useSendInvoiceEmailMutation();
  const receiptMutation = useSendReceiptEmailMutation();
  const historyQuery = useOrderDocumentEmailsQuery(isAdmin ? internalOrderId : '');
  const [recipient, setRecipient] = useState('');
  const [locale, setLocale] = useState<EmailLocale>('pl');
  const [sentVia, setSentVia] = useState<SentVia | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (!isAdmin) return null;

  const pending = invoiceMutation.isPending || receiptMutation.isPending;
  const last = historyQuery.data ? lastAttemptFor(historyQuery.data, documentId) : null;
  const titleId = `document-email-title-${documentId}`;
  const hintId = `document-email-hint-${documentId}`;

  async function handleSend(): Promise<void> {
    setRefusal(null);
    const trimmed = recipient.trim();
    const input = { locale, ...(trimmed ? { recipient: trimmed } : {}) };
    try {
      const result =
        kind === 'invoice'
          ? await invoiceMutation.mutateAsync({ invoiceId: documentId, input })
          : await receiptMutation.mutateAsync({ id: documentId, input });
      setSentVia(result.sentVia ?? null);
      showToast({
        tone: 'success',
        title: t('salesDocument.email.sent', 'Document emailed to buyer'),
        description: t('salesDocument.email.sentDesc', 'The buyer will receive it shortly.'),
      });
    } catch (error) {
      setSentVia(null);
      setRefusal(
        error instanceof Error && error.message
          ? error.message
          : t('salesDocument.email.failed', 'Could not email the document to the buyer.'),
      );
    } finally {
      // Failed attempts are recorded too, so the header and timeline refresh either way.
      void queryClient.invalidateQueries({ queryKey: ['orders', 'document-emails'] });
    }
  }

  const title = (
    <h3 id={titleId} className="document-email__title">
      <MailIcon />
      {t('salesDocument.email.title', 'Email to buyer')}
    </h3>
  );

  if (notReadyReason) {
    return (
      <section
        className="document-email document-email--waiting"
        aria-labelledby={titleId}
        data-testid="send-document-email"
      >
        <div className="document-email__waiting">
          <div className="document-email__waiting-copy">
            {title}
            <p className="document-email__hint" data-testid="send-document-email-not-ready">
              {notReadyReason}
            </p>
          </div>
          <Button tone="secondary" className="button--sm" disabled data-testid="send-document-email-button">
            {t('salesDocument.email.send', 'Send email')}
          </Button>
        </div>
      </section>
    );
  }

  const status =
    last === null ? (
      historyQuery.isSuccess ? (
        <span className="document-email__status">{t('salesDocument.email.statusNone', 'Not sent yet')}</span>
      ) : null
    ) : last.outcome === 'sent' ? (
      <span className="document-email__status document-email__status--sent" data-testid="send-document-email-status">
        <span className="document-email__dot" aria-hidden="true" />
        {t('salesDocument.email.statusSent', 'Sent')}
      </span>
    ) : (
      <span className="document-email__status document-email__status--failed" data-testid="send-document-email-status">
        <span className="document-email__dot" aria-hidden="true" />
        {t('salesDocument.email.statusFailed', 'Last attempt failed')}
      </span>
    );

  return (
    <section className="document-email" aria-labelledby={titleId} data-testid="send-document-email">
      <header className="document-email__header">
        {title}
        {status}
      </header>

      {last?.outcome === 'sent' ? (
        <p className="document-email__last" data-testid="send-document-email-last">
          {formatDateTime(last.createdAt)}
          {last.sentVia
            ? ` · ${
                last.sentVia === 'provider'
                  ? t('salesDocument.email.viaProvider', 'via the invoicing provider')
                  : t('salesDocument.email.viaOpenLinker', 'via OpenLinker')
              }`
            : ''}
        </p>
      ) : null}

      {refusal ? (
        <Alert tone="error" data-testid="send-document-email-error">
          {refusal}
        </Alert>
      ) : null}

      <label className="document-email__field">
        <span className="document-email__label">{t('salesDocument.email.recipient', 'Recipient')}</span>
        <Input
          type="email"
          value={recipient}
          disabled={pending}
          placeholder={t('salesDocument.email.recipientPlaceholder', "Buyer's address on the order")}
          aria-describedby={hintId}
          onChange={(e) => setRecipient(e.target.value)}
          data-testid="send-document-email-recipient"
        />
      </label>
      <p id={hintId} className="document-email__hint">
        {t(
          'salesDocument.email.recipientHint',
          "Leave empty to use the buyer's address on the order. A different address is sent by OpenLinker rather than the invoicing provider.",
        )}
      </p>

      <div className="document-email__actions">
        <SegmentedControl<EmailLocale>
          aria-label={t('salesDocument.email.language', 'Email language')}
          className="document-email__locale"
          value={locale}
          onChange={setLocale}
          options={[
            { value: 'pl', label: 'PL', disabled: pending },
            { value: 'en', label: 'EN', disabled: pending },
          ]}
          data-testid="send-document-email-locale"
        />
        <Button
          tone="primary"
          className="button--sm"
          disabled={pending}
          onClick={() => void handleSend()}
          data-testid="send-document-email-button"
        >
          {pending
            ? t('salesDocument.email.sending', 'Sending…')
            : last?.outcome === 'sent'
              ? t('salesDocument.email.sendAgain', 'Send again')
              : t('salesDocument.email.send', 'Send email')}
        </Button>
      </div>

      {sentVia ? (
        <p className="document-email__hint" data-testid="send-document-email-sent-via">
          {sentVia === 'provider'
            ? t('salesDocument.email.sentViaProvider', 'Sent via the invoicing provider.')
            : t('salesDocument.email.sentViaOpenLinker', "Sent via OpenLinker's mailer.")}
        </p>
      ) : null}
    </section>
  );
}
