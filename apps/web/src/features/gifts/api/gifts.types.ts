/**
 * Gifts - API types (#3940)
 *
 * Hand-mirrored from the order-edit gift route and the gift-attention read. The browser bundle does not depend on
 * `@openlinker/core` (#591), so the vocabularies below are copies; the server
 * narrows every value again, so a stale copy degrades to "not recognised"
 * rather than to a wrong write.
 *
 * @module apps/web/src/features/gifts/api
 */
import type { GiftDocumentFormChoice } from '../../gift-documents';

export interface AddGiftInput {
  variantId: string;
  quantity: number;
  documentForm?: GiftDocumentFormChoice;
  /** Gross unit price per gift unit; required with `custom-price`. */
  documentUnitPrice?: string;
  dryRun?: boolean;
}

export interface GiftAddedOutcome {
  lineKey: string | null;
  salesDocumentExists: boolean;
  reserved: boolean;
  onPickList: boolean;
}

export interface AddGiftResult {
  dryRun: boolean;
  changeId: string | null;
  gift?: GiftAddedOutcome;
}

/** One add-gift firing of an order that did not give its gift (`GET /orders/:id/gift-attention`). */
export interface GiftAttentionEntry {
  runId: string;
  ruleId: string;
  ruleName: string;
  outcome: 'failed' | 'not-applied';
  /** Why no gift was added, as a code; null when none was recorded. */
  reasonCode: string | null;
  dismissed: boolean;
  firedAt: string;
}

export interface GiftAttentionResult {
  items: GiftAttentionEntry[];
  recordingAvailable: boolean;
}
