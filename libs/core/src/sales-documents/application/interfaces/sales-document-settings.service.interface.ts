/**
 * Sales Document Settings Service Interface (#3941)
 *
 * The OpenLinker-wide sales-document settings. Resolution is
 * `saved row -> code default`, and every value is reported with its source so a
 * surface can say "OpenLinker default" instead of comparing against a number.
 *
 * @module libs/core/src/sales-documents/application/interfaces
 */
import type { GiftDocumentFormChoice } from '../../domain/types/gift-lines.types';

export interface GiftDocumentFormSetting {
  form: GiftDocumentFormChoice;
  /** Set only when `form` is `custom-price`: the gross unit price per gift unit. */
  unitPrice: string | null;
  source: 'setting' | 'default';
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface ISalesDocumentSettingsService {
  /** The OpenLinker-wide gift form on documents. Never throws on a missing row. */
  getGiftDocumentForm(): Promise<GiftDocumentFormSetting>;
  /**
   * Save the default. Throws `InvalidGiftDocumentFormError` for a form not on
   * offer, or a `custom-price` without a valid amount. The amount is dropped
   * for any other form.
   */
  setGiftDocumentForm(
    form: string,
    updatedBy: string | null,
    unitPrice?: string | null,
  ): Promise<GiftDocumentFormSetting>;
}
