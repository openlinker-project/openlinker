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
): SalesDocumentHeadlineModel {
  const identity =
    invoice.providerInvoiceNumber || connectionName
      ? `${invoice.providerInvoiceNumber ?? '—'} · ${connectionName}`
      : null;

  if (invoice.status === 'pending' || invoice.status === 'issuing') {
    return { state: 'Issuing', tone: 'progress', identity };
  }

  if (invoice.status === 'failed') {
    return invoice.failureMode === 'rejected'
      ? { state: 'Rejected', tone: 'error', identity }
      : { state: 'Unconfirmed', tone: 'warning', identity };
  }

  // status === 'issued' — the clearance axis decides the word from here.
  switch (invoice.regulatoryStatus) {
    case 'rejected':
      return { state: 'Rejected by authority', tone: 'error', identity };
    case 'pending-submission':
    case 'submitted':
      return { state: 'Awaiting clearance', tone: 'progress', identity };
    case 'cleared':
    case 'accepted':
      return { state: 'Cleared', tone: 'done', identity };
    case 'not-applicable':
    default:
      return { state: 'Issued', tone: 'done', identity };
  }
}

export function resolveFiscalHeadline(
  record: FiscalRegistrationRecord | null,
  progress: FiscalRegistrationProgress | undefined,
  connectionName: string,
  contended: boolean,
): SalesDocumentHeadlineModel {
  const identity =
    record?.documentReference || connectionName
      ? `${record?.documentReference ?? '—'} · ${connectionName}`
      : null;

  if (contended) {
    return { state: 'In progress elsewhere', tone: 'progress', identity: null };
  }
  if (progress === 'queued' || progress === 'running') {
    return { state: 'Registering', tone: 'progress', identity: null };
  }
  if (progress === 'stalled') {
    return { state: 'Stalled', tone: 'warning', identity: null };
  }
  if (progress === 'interrupted') {
    return { state: 'Unconfirmed', tone: 'warning', identity: null };
  }

  if (!record) {
    return { state: 'Not registered', tone: 'idle', identity: null };
  }
  if (record.status === 'registered') {
    return { state: 'Registered', tone: 'done', identity };
  }
  if (record.status === 'failed') {
    return record.failureMode === 'rejected'
      ? { state: 'Rejected', tone: 'error', identity }
      : { state: 'Unconfirmed', tone: 'warning', identity };
  }
  return { state: 'Registering', tone: 'progress', identity };
}
