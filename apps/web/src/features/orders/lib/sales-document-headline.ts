/**
 * Sales-Document Panel Headline (#2557)
 *
 * Turns an invoice or a fiscal-registration record into the props the shared
 * `DocumentHeadline` primitive needs, so the order-detail panel describes a
 * document in the exact words the `/orders` row uses for the same order (M5).
 *
 * Pure — no React, no I/O — so every branch is testable directly. `tone` never
 * marks a finished document: `done` carries the tick DocumentHeadline itself
 * draws, and a healthy `not-applicable` clearance or a `registered` receipt
 * both resolve to `done`, never to a colour-only `success`.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { ReactNode } from 'react';
import type { DocumentHeadlineTone } from '../../../shared/ui/document-headline';
import type { InvoiceRecord } from '../../invoicing';
import type { FiscalRegistrationProgress, FiscalRegistrationRecord } from '../../fiscalization';

/**
 * The panel's translator, narrowed to what this module needs: a key plus the
 * English fallback that ships as the default copy. Taken as a PARAMETER rather
 * than read from a hook so the module stays pure and directly testable, and so
 * these strings go through the same `t(key, fallback)` path as every other
 * string in the panel instead of being the one place that hardcodes English.
 */
export type HeadlineTranslate = (key: string, fallback: string) => string;

const identityOf = (reference: string | null | undefined, connectionName: string): string | null => {
  // No em-dash placeholder: a document with no number yet is described by the
  // connection alone, rather than by a dash that reads like a missing value.
  if (reference && connectionName) return `${reference} \u00B7 ${connectionName}`;
  return reference || connectionName || null;
};

export interface SalesDocumentHeadlineModel {
  state: string;
  tone: DocumentHeadlineTone;
  identity: ReactNode | null;
}

/**
 * The invoice headline. `state` names the STAGE the document is actually
 * at — issuance and clearance are two different axes (ADR-065), and a
 * finished-but-not-cleared invoice must not read as plain "Issued" once a
 * clearance answer exists.
 */
export function resolveInvoiceHeadline(
  invoice: InvoiceRecord,
  connectionName: string,
  t: HeadlineTranslate,
): SalesDocumentHeadlineModel {
  const identity = identityOf(invoice.providerInvoiceNumber, connectionName);

  if (invoice.status === 'pending' || invoice.status === 'issuing') {
    return { state: t('salesDocument.headline.issuing', 'Issuing'), tone: 'progress', identity };
  }

  if (invoice.status === 'failed') {
    return invoice.failureMode === 'rejected'
      ? { state: t('salesDocument.headline.rejected', 'Rejected'), tone: 'error', identity }
      : { state: t('salesDocument.headline.unconfirmed', 'Unconfirmed'), tone: 'warning', identity };
  }

  // status === 'issued' — the clearance axis decides the word from here.
  switch (invoice.regulatoryStatus) {
    case 'rejected':
      return { state: t('salesDocument.headline.rejectedByAuthority', 'Rejected by authority'), tone: 'error', identity };
    case 'pending-submission':
    case 'submitted':
      return { state: t('salesDocument.headline.awaitingClearance', 'Awaiting clearance'), tone: 'progress', identity };
    case 'cleared':
    case 'accepted':
      return { state: t('salesDocument.headline.cleared', 'Cleared'), tone: 'done', identity };
    case 'not-applicable':
    default:
      return { state: t('salesDocument.headline.issued', 'Issued'), tone: 'done', identity };
  }
}

export function resolveFiscalHeadline(
  record: FiscalRegistrationRecord | null,
  progress: FiscalRegistrationProgress | undefined,
  connectionName: string,
  contended: boolean,
  t: HeadlineTranslate,
): SalesDocumentHeadlineModel {
  const identity = identityOf(record?.documentReference, connectionName);

  if (contended) {
    return { state: t('salesDocument.headline.inProgressElsewhere', 'In progress elsewhere'), tone: 'progress', identity: null };
  }
  if (progress === 'queued' || progress === 'running') {
    return { state: t('salesDocument.headline.registering', 'Registering'), tone: 'progress', identity: null };
  }
  if (progress === 'stalled') {
    return { state: t('salesDocument.headline.stalled', 'Stalled'), tone: 'warning', identity: null };
  }
  if (progress === 'interrupted') {
    return { state: t('salesDocument.headline.unconfirmed', 'Unconfirmed'), tone: 'warning', identity: null };
  }

  if (!record) {
    return { state: t('salesDocument.headline.notRegistered', 'Not registered'), tone: 'idle', identity: null };
  }
  if (record.status === 'registered') {
    return { state: t('salesDocument.headline.registered', 'Registered'), tone: 'done', identity };
  }
  if (record.status === 'failed') {
    return record.failureMode === 'rejected'
      ? { state: t('salesDocument.headline.rejected', 'Rejected'), tone: 'error', identity }
      : { state: t('salesDocument.headline.unconfirmed', 'Unconfirmed'), tone: 'warning', identity };
  }
  return { state: t('salesDocument.headline.registering', 'Registering'), tone: 'progress', identity };
}
