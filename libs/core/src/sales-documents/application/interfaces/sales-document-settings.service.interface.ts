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
  source: 'setting' | 'default';
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface ISalesDocumentSettingsService {
  /** The OpenLinker-wide gift form on documents. Never throws on a missing row. */
  getGiftDocumentForm(): Promise<GiftDocumentFormSetting>;
  /** Save the default. Throws `InvalidGiftDocumentFormError` for a form not on offer. */
  setGiftDocumentForm(
    form: string,
    updatedBy: string | null,
  ): Promise<GiftDocumentFormSetting>;
}
