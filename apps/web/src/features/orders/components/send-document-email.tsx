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
 * The recipient is an explicit choice (#4066): a checkbox, on by default,
 * names the buyer's order address that will be used. An empty text field used
 * to stand for that default, which reads as a missing value rather than a
 * choice. Checked, the request omits `recipient` so the server resolves the
 * buyer address exactly as before; unchecked, the operator must type a valid
 * address. An order with no buyer email offers no such choice at all.
 *
 * The header reports the LAST attempt for this document from the same history
 * the Activity timeline reads. A failed read shows no status rather than "Not
 * sent yet", which would be a claim about a history we could not load.
 *
 * @module apps/web/src/features/orders/components
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FilterCheck } from '../../../shared/ui/filter-check';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { useToast } from '../../../shared/ui/toast-provider';
import { useSendInvoiceEmailMutation } from '../../invoicing';
import { useSendReceiptEmailMutation } from '../../fiscalization';
import { useOrderDocumentEmailsQuery } from '../hooks/use-order-document-emails-query';
import type { OrderDocumentEmailEntry } from '../api/orders.types';
import { serverErrorText } from '../lib/server-error-text';

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
  /**
   * The buyer's email on the order snapshot. `null` when the order carries
   * none (PII storage off, or the source sent no address), in which case the
   * operator has to type the recipient.
   */
  buyerEmail: string | null;
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
  buyerEmail,
}: SendDocumentEmailProps): ReactElement | null {
  const copy = useMessages('orders').sendDocumentEmail;
  const serverSaid = useMessages('orders').common.serverSaid;
  const format = useFormat();
  const isAdmin = useIsAdmin();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const invoiceMutation = useSendInvoiceEmailMutation();
  const receiptMutation = useSendReceiptEmailMutation();
  const historyQuery = useOrderDocumentEmailsQuery(isAdmin ? internalOrderId : '');
  const [recipient, setRecipient] = useState('');
  const [recipientValid, setRecipientValid] = useState(false);
  const [useBuyerAddress, setUseBuyerAddress] = useState(buyerEmail !== null);
  const recipientRef = useRef<HTMLInputElement>(null);
  // Focus only after an operator unchecks the box: the input is still disabled
  // in the render that handles the click, so focusing there would be a no-op.
  const focusRecipientRef = useRef(false);

  useEffect(() => {
    if (!useBuyerAddress && focusRecipientRef.current) {
      focusRecipientRef.current = false;
      recipientRef.current?.focus();
    }
  }, [useBuyerAddress]);
  const [locale, setLocale] = useState<EmailLocale>('pl');
  const [sentVia, setSentVia] = useState<SentVia | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (!isAdmin) return null;

  const pending = invoiceMutation.isPending || receiptMutation.isPending;
  const last = historyQuery.data ? lastAttemptFor(historyQuery.data, documentId) : null;
  const titleId = `document-email-title-${documentId}`;
  const hintId = `document-email-hint-${documentId}`;
  const sendsToBuyer = useBuyerAddress && buyerEmail !== null;
  const canSend = sendsToBuyer || (recipient.trim().length > 0 && recipientValid);

  async function handleSend(): Promise<void> {
    setRefusal(null);
    // Omitting `recipient` lets the server use the buyer's order address, the
    // same payload the pre-#4066 empty field produced.
    const input = { locale, ...(sendsToBuyer ? {} : { recipient: recipient.trim() }) };
    try {
      const result =
        kind === 'invoice'
          ? await invoiceMutation.mutateAsync({ invoiceId: documentId, input })
          : await receiptMutation.mutateAsync({ id: documentId, input });
      setSentVia(result.sentVia ?? null);
      showToast({
        tone: 'success',
        title: copy.sent,
        description: copy.sentDesc,
      });
    } catch (error) {
      setSentVia(null);
      setRefusal(
        serverErrorText(serverSaid, error instanceof Error ? error.message : undefined, copy.failed),
      );
    } finally {
      // Failed attempts are recorded too, so the header and timeline refresh either way.
      void queryClient.invalidateQueries({ queryKey: ['orders', 'document-emails'] });
    }
  }

  const title = (
    <h3 id={titleId} className="document-email__title">
      <MailIcon />
      {copy.title}
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
            {copy.send}
          </Button>
        </div>
      </section>
    );
  }

  const status =
    last === null ? (
      historyQuery.isSuccess ? (
        <span className="document-email__status">{copy.statusNone}</span>
      ) : null
    ) : last.outcome === 'sent' ? (
      <span className="document-email__status document-email__status--sent" data-testid="send-document-email-status">
        <span className="document-email__dot" aria-hidden="true" />
        {copy.statusSent}
      </span>
    ) : (
      <span className="document-email__status document-email__status--failed" data-testid="send-document-email-status">
        <span className="document-email__dot" aria-hidden="true" />
        {copy.statusFailed}
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
          {last.sentVia
            ? interpolate(copy.lastSentVia, {
                when: format.dateTime(last.createdAt),
                via: last.sentVia === 'provider' ? copy.viaProvider : copy.viaOpenLinker,
              })
            : format.dateTime(last.createdAt)}
        </p>
      ) : null}

      {refusal ? (
        <Alert tone="error" data-testid="send-document-email-error">
          {refusal}
        </Alert>
      ) : null}

      <div className="document-email__field">
        <span className="document-email__label">{copy.recipient}</span>
        <FilterCheck
          checked={sendsToBuyer}
          disabled={pending || buyerEmail === null}
          label={
            buyerEmail === null
              ? copy.useBuyerAddressNone
              : interpolate(copy.useBuyerAddress, { email: buyerEmail })
          }
          onChange={(e) => {
            const checked = e.target.checked;
            if (!checked) {
              focusRecipientRef.current = true;
              setRecipient('');
              setRecipientValid(false);
            }
            setUseBuyerAddress(checked);
          }}
          data-testid="send-document-email-use-buyer"
        />
        {buyerEmail === null ? (
          <p className="document-email__hint" data-testid="send-document-email-no-buyer">
            {copy.noBuyerEmail}
          </p>
        ) : null}
        <Input
          ref={recipientRef}
          type="email"
          aria-label={copy.recipient}
          value={sendsToBuyer ? buyerEmail : recipient}
          disabled={pending || sendsToBuyer}
          required={!sendsToBuyer}
          aria-describedby={sendsToBuyer ? undefined : hintId}
          onChange={(e) => {
            setRecipient(e.target.value);
            setRecipientValid(e.target.validity.valid);
          }}
          data-testid="send-document-email-recipient"
        />
      </div>
      {sendsToBuyer ? null : (
        <p id={hintId} className="document-email__hint" data-testid="send-document-email-other-hint">
          {copy.otherAddressHint}
        </p>
      )}

      <div className="document-email__actions">
        <SegmentedControl<EmailLocale>
          aria-label={copy.language}
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
          disabled={pending || !canSend}
          onClick={() => void handleSend()}
          data-testid="send-document-email-button"
        >
          {pending
            ? copy.sending
            : last?.outcome === 'sent'
              ? copy.sendAgain
              : copy.send}
        </Button>
      </div>

      {sentVia ? (
        <p className="document-email__hint" data-testid="send-document-email-sent-via">
          {sentVia === 'provider'
            ? copy.sentViaProvider
            : copy.sentViaOpenLinker}
        </p>
      ) : null}
    </section>
  );
}
