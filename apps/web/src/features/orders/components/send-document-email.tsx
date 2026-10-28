/**
 * SendDocumentEmail (#3551)
 *
 * One neutral "Send by email" control for every issued sales document - an
 * invoice from any provider or a fiscal receipt. Which provider delivers is the
 * server's decision and is reported back ("Sent via"), so no platform type is
 * read here. Admin-only because both routes are `@Roles('admin')`. A manual
 * send never depends on the connection's automatic buyer-email setting (D6).
 *
 * A refusal renders the server's own sentence verbatim; the closed `code` is
 * only used to pick the tone, never to rewrite what the operator reads.
 *
 * @module apps/web/src/features/orders/components
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import { useTranslation } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { useSendInvoiceEmailMutation } from '../../invoicing';
import { useSendReceiptEmailMutation } from '../../fiscalization';

type EmailLocale = 'pl' | 'en';
type SentVia = 'provider' | 'openlinker';

interface SendDocumentEmailProps {
  kind: 'invoice' | 'fiscal-receipt';
  documentId: string;
}

export function SendDocumentEmail({ kind, documentId }: SendDocumentEmailProps): ReactElement | null {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const invoiceMutation = useSendInvoiceEmailMutation();
  const receiptMutation = useSendReceiptEmailMutation();
  const [recipient, setRecipient] = useState('');
  const [locale, setLocale] = useState<EmailLocale>('pl');
  const [sentVia, setSentVia] = useState<SentVia | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (!isAdmin) return null;

  const pending = invoiceMutation.isPending || receiptMutation.isPending;

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
      // Failed attempts are recorded too, so the timeline refreshes either way.
      void queryClient.invalidateQueries({ queryKey: ['orders', 'document-emails'] });
    }
  }

  return (
    <div className="sales-document-panel__email" data-testid="send-document-email">
      <label>
        <span className="text-muted">{t('salesDocument.email.recipient', 'Recipient')}</span>
        <Input
          type="email"
          value={recipient}
          disabled={pending}
          placeholder={t('salesDocument.email.recipientPlaceholder', "Buyer's address on the order")}
          onChange={(e) => setRecipient(e.target.value)}
          data-testid="send-document-email-recipient"
        />
      </label>
      <label>
        <span className="text-muted">{t('salesDocument.email.language', 'Email language')}</span>
        <Select
          value={locale}
          disabled={pending}
          onChange={(e) => setLocale(e.target.value as EmailLocale)}
        >
          <option value="pl">{t('salesDocument.email.localePl', 'Polish')}</option>
          <option value="en">{t('salesDocument.email.localeEn', 'English')}</option>
        </Select>
      </label>
      <Button
        tone="primary"
        className="button--sm"
        disabled={pending}
        onClick={() => void handleSend()}
        data-testid="send-document-email-button"
      >
        {pending
          ? t('salesDocument.email.sending', 'Sending…')
          : t('salesDocument.email.send', 'Send by email')}
      </Button>
      {sentVia ? (
        <p className="text-muted" data-testid="send-document-email-sent-via">
          {sentVia === 'provider'
            ? t('salesDocument.email.sentViaProvider', "Sent via the invoicing provider.")
            : t('salesDocument.email.sentViaOpenLinker', "Sent via OpenLinker's mailer.")}
        </p>
      ) : null}
      {refusal ? (
        <Alert tone="error" data-testid="send-document-email-error">
          {refusal}
        </Alert>
      ) : null}
    </div>
  );
}
