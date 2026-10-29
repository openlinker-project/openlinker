/**
 * Buyer Emails Copy (#3555)
 *
 * Every operator-facing sentence of the buyer-emails settings, editor and
 * order panel, in one place.
 *
 * @module apps/web/src/features/buyer-emails/lib
 */
import type { BuyerEmailTemplate } from '../api/buyer-emails.types';

export const BUYER_EMAIL_TEMPLATE_COPY: Record<
  BuyerEmailTemplate,
  { label: string; description: string }
> = {
  'order-confirmed': {
    label: 'Order confirmed',
    description: 'Sent once, when OpenLinker takes a new order in. Shop orders only.',
  },
  shipped: {
    label: 'Shipped',
    description: "Sent when the order's parcels are handed to the carrier.",
  },
  'document-issued': {
    label: 'Invoice or receipt issued',
    description: "Sent when the order's sales document is issued.",
  },
  'return-received': {
    label: 'Return received',
    description: 'Sent once per return, when the first parcel reaches your warehouse.',
  },
};

/** The label for a template key the API returned, including one this build does not know. */
export function templateLabel(templateKey: string): string {
  return (
    (BUYER_EMAIL_TEMPLATE_COPY as Record<string, { label: string } | undefined>)[templateKey]
      ?.label ?? 'Buyer email'
  );
}

export const BUYER_EMAILS_COPY = {
  page: {
    title: 'Buyer emails',
    description: 'Automatic emails sent to buyers as their order moves through fulfilment.',
    connectionLabel: 'Connection',
    noConnections: 'No connection that takes orders exists yet.',
    masterLabel: 'Send buyer emails for this connection',
    offNote:
      'Off by default. The channel already notifies its buyers about their orders, so these emails are an addition, not a replacement - turn them on only if you want buyers to hear from you as well.',
    marketplaceNote:
      'This is a marketplace connection. Only transactional emails can be sent here, to the address the marketplace provides on the order. "Order confirmed" is the shop\'s own message and is not offered.',
    templateHeader: 'Email',
    statusHeader: 'Status',
    senderHeader: 'Sender',
    statusOn: 'On',
    statusOff: 'Off',
    statusInactiveBecauseMaster: 'Off (emails are off for this connection)',
    defaultSender: 'Mail settings default',
    edit: 'Edit',
    saved: 'Buyer emails updated.',
    loadError: 'Could not load the connection.',
  },
  editor: {
    back: 'Buyer emails',
    enabledLabel: 'Send this email',
    fromLabel: 'Sender address',
    fromHint: 'Optional. Leave empty to use the sender from the mail settings.',
    replyToLabel: 'Reply-to address',
    subjectLabel: 'Subject',
    bodyLabel: 'Message',
    sharedWording:
      'The subject and message are shared by every connection. The switch, sender and reply-to apply to this connection only.',
    variablesTitle: 'Variables',
    variablesHint: 'Click to insert into the message.',
    previewTitle: 'Preview',
    testTitle: 'Send a test',
    testToLabel: 'Send to',
    testSend: 'Send test email',
    testSent: (to: string) => `Test email sent to ${to}.`,
    testSentDetail:
      'It used the subject and message as typed here, and the sender of this connection. Real emails use the same mail transport.',
    save: 'Save changes',
    cancel: 'Cancel',
    invalidAddress: 'Enter one email address.',
    noRule:
      'The ready-made rule for this email is missing, so its wording cannot be edited here. The switch and sender still save.',
    notAllowed: 'This email is not offered on a marketplace connection.',
  },
  order: {
    title: 'Buyer emails',
    empty: 'No buyer email has been attempted for this order.',
    loadError: 'Could not load the buyer emails of this order.',
    sent: 'Sent',
    suppressed: 'Not sent',
    bounced: 'Bounced',
    pending: 'Sending',
    pendingDetail:
      'OpenLinker started this send and has no answer from the mail server yet. It will not send it again.',
    bouncedDetail: "The buyer's mail server refused the address. Check the email address on the order.",
    suppressedFallback: 'This email was not sent.',
  },
  tile: {
    eyebrow: 'Orders',
    title: 'Buyer emails',
    description: 'Choose which emails buyers get from you, per connection, and edit their wording.',
    link: 'Set up buyer emails',
  },
} as const;
