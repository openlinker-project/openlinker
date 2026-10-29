/**
 * Order document email wording (#3550)
 *
 * The readable sentence for each refusal (mockup M24 note 9: the dialog shows the
 * server's own message) and the message OpenLinker composes when it, rather than
 * the provider, sends a document. Pure: no I/O, no clock, no framework.
 *
 * Country-agnostic (ADR-026): wording only ever names the document the caller
 * hands in. The receipt copy states that the message is a SUMMARY and the legal
 * receipt is at the link - OpenLinker never presents its summary as the receipt.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { DocumentEmailFailureReason } from '@openlinker/core/sales-documents';

/** The refusals, including the one that has no order to attach a timeline row to. */
export const OrderDocumentEmailRefusalValues = [
  'document-not-found',
  'not-issued',
  'document-not-ready',
  'no-document',
  'no-recipient',
  'invalid-recipient',
  'mailer-unavailable',
  'send-failed',
] as const satisfies readonly ('document-not-found' | DocumentEmailFailureReason)[];

export type OrderDocumentEmailRefusal = (typeof OrderDocumentEmailRefusalValues)[number];

/** Neutral document language for the message OpenLinker composes. */
export type OrderDocumentEmailLocale = 'pl' | 'en';

export const ORDER_DOCUMENT_EMAIL_REFUSAL_MESSAGE: Record<OrderDocumentEmailRefusal, string> = {
  'document-not-found': 'This document does not exist.',
  'not-issued': 'This document was not fully issued, so there is nothing to send.',
  // `waiting` from the attachment read also covers a provider that did not
  // answer (#3548), so the sentence must not claim the document is uncleared.
  'document-not-ready':
    'The document cannot be fetched right now: it may not be cleared yet, or the provider did not answer. Try again in a moment.',
  'no-document':
    'There is no document to attach: the provider returned neither a file nor a link for it.',
  'no-recipient': 'This order has no buyer email address. Enter a recipient.',
  'invalid-recipient': 'The recipient is not a valid email address.',
  'mailer-unavailable': 'Email sending is not configured on this server.',
  'send-failed': 'The email could not be sent. Try again in a moment.',
};

export interface ComposedEmail {
  subject: string;
  text: string;
}

export interface InvoiceEmailParts {
  locale: OrderDocumentEmailLocale;
  /** The document number the buyer will recognise; absent when the provider issued none. */
  documentNumber: string | null;
  /** Set when the document is a link rather than an attachment. */
  link: string | null;
}

export function composeInvoiceEmail(parts: InvoiceEmailParts): ComposedEmail {
  const number = parts.documentNumber;
  if (parts.locale === 'pl') {
    const body = parts.link
      ? `Dokument jest dostępny pod adresem:\n${parts.link}`
      : 'Dokument znajduje się w załączniku.';
    return {
      subject: number ? `Faktura ${number}` : 'Twoja faktura',
      text: `Dzień dobry,\n\nprzesyłamy fakturę${number ? ` ${number}` : ''} do Twojego zamówienia.\n\n${body}\n`,
    };
  }
  const body = parts.link
    ? `The document is available at:\n${parts.link}`
    : 'The document is attached.';
  return {
    subject: number ? `Invoice ${number}` : 'Your invoice',
    text: `Hello,\n\nHere is the invoice${number ? ` ${number}` : ''} for your order.\n\n${body}\n`,
  };
}

export interface ReceiptEmailParts {
  locale: OrderDocumentEmailLocale;
  documentReference: string | null;
  /** ISO date (YYYY-MM-DD) the sale was registered, when known. */
  registeredOn: string | null;
  /** The legal e-receipt's public link. */
  link: string;
}

export function composeReceiptEmail(parts: ReceiptEmailParts): ComposedEmail {
  const reference = parts.documentReference;
  if (parts.locale === 'pl') {
    const lines = [
      'Dzień dobry,',
      '',
      'to jest podsumowanie Twojego paragonu przygotowane przez OpenLinker. To podsumowanie nie jest paragonem.',
      '',
      ...(reference ? [`Numer: ${reference}`] : []),
      ...(parts.registeredOn ? [`Data: ${parts.registeredOn}`] : []),
      '',
      'Paragon w obowiązującej formie znajdziesz tutaj:',
      parts.link,
      '',
    ];
    return { subject: reference ? `Paragon ${reference}` : 'Twój paragon', text: lines.join('\n') };
  }
  const lines = [
    'Hello,',
    '',
    'This is a summary of your receipt prepared by OpenLinker. This summary is not the receipt.',
    '',
    ...(reference ? [`Number: ${reference}`] : []),
    ...(parts.registeredOn ? [`Date: ${parts.registeredOn}`] : []),
    '',
    'The receipt itself is available here:',
    parts.link,
    '',
  ];
  return { subject: reference ? `Receipt ${reference}` : 'Your receipt', text: lines.join('\n') };
}

/** A filename-safe name for the attached PDF. */
export function invoiceAttachmentFilename(documentNumber: string | null): string {
  const safe = (documentNumber ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe.length > 0 ? `invoice-${safe}.pdf` : 'invoice.pdf';
}

/**
 * Replace email-shaped substrings so an error from a provider or the mailer can
 * be logged without embedding a buyer's address ("inFakt 500: buyer
 * bob@secret.pl"). Best-effort log hygiene, not RFC 5322 validation - the same
 * posture as the invoice controller's own scrub.
 */
export function scrubEmailAddresses(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]');
}
