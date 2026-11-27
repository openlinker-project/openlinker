/**
 * Sales Document Settings Service (#3941)
 *
 * Reads and writes the OpenLinker-wide gift form on documents, the lowest of
 * the three levels (gift, connection, default; gifts spec section 8.3). A read
 * that fails to find a row, or finds a value this build does not recognise,
 * resolves to the code default: a stored value must never break an issuance.
 *
 * @module libs/core/src/sales-documents/application/services
 * @implements {ISalesDocumentSettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { SalesDocumentSettingRepositoryPort } from '../../domain/ports/sales-document-setting-repository.port';
import { InvalidGiftDocumentFormError } from '../../domain/exceptions/invalid-gift-document-form.error';
import {
  DEFAULT_GIFT_LINE_FORM,
  GiftDocumentFormChoiceValues,
  isGiftUnitPriceAmount,
  type GiftDocumentFormChoice,
} from '../../domain/types/gift-lines.types';
import { SALES_DOCUMENT_SETTING_REPOSITORY_TOKEN } from '../../sales-documents.tokens';
import type {
  GiftDocumentFormSetting,
  ISalesDocumentSettingsService,
} from '../interfaces/sales-document-settings.service.interface';

function narrow(value: string | null): GiftDocumentFormChoice | null {
  return value !== null && (GiftDocumentFormChoiceValues as readonly string[]).includes(value)
    ? (value as GiftDocumentFormChoice)
    : null;
}

@Injectable()
export class SalesDocumentSettingsService implements ISalesDocumentSettingsService {
  constructor(
    @Inject(SALES_DOCUMENT_SETTING_REPOSITORY_TOKEN)
    private readonly repository: SalesDocumentSettingRepositoryPort,
  ) {}

  async getGiftDocumentForm(): Promise<GiftDocumentFormSetting> {
    const row = await this.repository.findSetting();
    const form = narrow(row?.giftDocumentForm ?? null);
    const unitPrice = isGiftUnitPriceAmount(row?.giftDocumentUnitPrice)
      ? row.giftDocumentUnitPrice
      : null;
    // A saved `custom-price` whose amount is unusable resolves to the code default.
    if (row === null || form === null || (form === 'custom-price' && unitPrice === null)) {
      return {
        form: DEFAULT_GIFT_LINE_FORM as GiftDocumentFormChoice,
        unitPrice: null,
        source: 'default',
        updatedAt: null,
        updatedBy: null,
      };
    }
    return {
      form,
      unitPrice: form === 'custom-price' ? unitPrice : null,
      source: 'setting',
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  async setGiftDocumentForm(
    form: string,
    updatedBy: string | null,
    unitPrice?: string | null,
  ): Promise<GiftDocumentFormSetting> {
    const choice = narrow(form);
    if (choice === null) throw new InvalidGiftDocumentFormError(form);
    if (choice === 'custom-price' && !isGiftUnitPriceAmount(unitPrice)) {
      throw new InvalidGiftDocumentFormError(
        form,
        'custom-price needs a positive amount with at most 2 decimals',
      );
    }
    const amount = choice === 'custom-price' ? (unitPrice as string) : null;
    const saved = await this.repository.upsertGiftDocumentForm(choice, amount, updatedBy);
    return {
      form: choice,
      unitPrice: amount,
      source: 'setting',
      updatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy,
    };
  }
}
