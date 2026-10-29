/**
 * Marketplace upload copy (#3549)
 *
 * The one table that says what each upload state means to an operator, so the
 * badge, the explanation and the retry affordance cannot drift apart. `retryable`
 * is a statement about whether another attempt can change the result: it is
 * false for a marketplace that cannot take documents and for a refusal.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import type {
  InvoiceMarketplaceUploadEntry,
  InvoiceMarketplaceUploadStatus,
} from '../api/invoicing.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

export interface MarketplaceUploadCopy {
  label: string;
  tone: StatusBadgeTone;
  explanation: string;
  retryable: boolean;
}

const STATUS_COPY: Record<InvoiceMarketplaceUploadStatus, MarketplaceUploadCopy> = {
  pending: {
    label: 'Sending to marketplace',
    tone: 'info',
    explanation: 'The document is being attached to the marketplace order.',
    retryable: false,
  },
  uploaded: {
    label: 'On the marketplace order',
    tone: 'success',
    explanation: 'The buyer can see this document on the marketplace order.',
    retryable: false,
  },
  failed: {
    label: 'Not delivered to marketplace',
    tone: 'error',
    explanation: 'The document could not be attached to the marketplace order.',
    retryable: true,
  },
  unsupported: {
    label: 'Not supported by marketplace',
    tone: 'neutral',
    explanation: 'This marketplace does not accept documents through OpenLinker.',
    retryable: false,
  },
  'no-file': {
    label: 'No file to send',
    tone: 'neutral',
    explanation:
      'This document has no PDF OpenLinker can send - only a link, or nothing yet. It is tried again when a file appears.',
    retryable: true,
  },
};

const UNKNOWN_COPY: MarketplaceUploadCopy = {
  label: 'Unknown upload state',
  tone: 'neutral',
  explanation: 'This build does not recognise the upload state reported by the server.',
  retryable: false,
};

const FAILURE_EXPLANATION: Record<string, string> = {
  rejected: 'The marketplace refused the file, so trying again will not help.',
  transient: 'The marketplace did not accept the file this time. Trying again may work.',
  'adapter-unresolved':
    'OpenLinker could not reach the marketplace connection. Check that it is active, then try again.',
  'order-unmapped': 'OpenLinker does not know this order on the marketplace connection yet.',
};

export function resolveMarketplaceUploadCopy(
  entry: InvoiceMarketplaceUploadEntry,
): MarketplaceUploadCopy {
  const base = STATUS_COPY[entry.status] ?? UNKNOWN_COPY;
  if (entry.status !== 'failed' || entry.lastFailureCode === null) return base;
  return {
    ...base,
    explanation: FAILURE_EXPLANATION[entry.lastFailureCode] ?? base.explanation,
    retryable: entry.lastFailureCode !== 'rejected',
  };
}
