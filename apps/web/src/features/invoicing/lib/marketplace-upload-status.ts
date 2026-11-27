/**
 * Marketplace upload status (#3549)
 *
 * The one table that says what each upload state means to an operator, so the
 * badge, the explanation and the retry affordance cannot drift apart. `retryable`
 * is a statement about whether another attempt can change the result: it is
 * false for a marketplace that cannot take documents and for a refusal.
 *
 * The words live in the `invoicing` namespace and are read at call time, so a
 * language switch takes effect on the next render.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import { getMessages } from '../../../shared/i18n';
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

const STATUS_SHAPE: Record<
  InvoiceMarketplaceUploadStatus,
  Pick<MarketplaceUploadCopy, 'tone' | 'retryable'>
> = {
  pending: { tone: 'info', retryable: false },
  uploaded: { tone: 'success', retryable: false },
  failed: { tone: 'error', retryable: true },
  unsupported: { tone: 'neutral', retryable: false },
  'no-file': { tone: 'neutral', retryable: true },
};

export function resolveMarketplaceUploadCopy(
  entry: InvoiceMarketplaceUploadEntry,
): MarketplaceUploadCopy {
  const copy = getMessages('invoicing').invoice.marketplaceUpload;
  const shape = STATUS_SHAPE[entry.status] as
    | Pick<MarketplaceUploadCopy, 'tone' | 'retryable'>
    | undefined;
  const base: MarketplaceUploadCopy = shape
    ? {
        label: copy.status[entry.status],
        explanation: copy.explanation[entry.status],
        ...shape,
      }
    : {
        label: copy.unknown.label,
        tone: 'neutral',
        explanation: copy.unknown.explanation,
        retryable: false,
      };
  if (entry.status !== 'failed' || entry.lastFailureCode === null) return base;
  const failure = copy.failure as Readonly<Record<string, string | undefined>>;
  return {
    ...base,
    explanation: failure[entry.lastFailureCode] ?? base.explanation,
    retryable: entry.lastFailureCode !== 'rejected',
  };
}
