/**
 * Gift documents - API types (#3941)
 *
 * @module apps/web/src/features/gift-documents/api
 */
import type { GiftDocumentFormChoice } from '../lib/gift-lines';

export type GiftDocumentFormSource = 'setting' | 'default';

export interface GiftDocumentSettingsResponse {
  giftDocumentForm: GiftDocumentFormChoice;
  /** The gross unit price a `custom-price` gift shows at; `null` for every other form. */
  giftDocumentUnitPrice?: string | null;
  giftDocumentFormSource: GiftDocumentFormSource;
  updatedAt: string | null;
}

export interface DocumentProviderZeroSupport {
  connectionId: string;
  name: string;
  platformType: string;
  kind: 'invoice' | 'fiscal-receipt';
  /** `null` = the provider declares nothing. A receipt always reads `false`. */
  acceptsZeroValueLine: boolean | null;
}

export interface DocumentProvidersResponse {
  providers: DocumentProviderZeroSupport[];
}
