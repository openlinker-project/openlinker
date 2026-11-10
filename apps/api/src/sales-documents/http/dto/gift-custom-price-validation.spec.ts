import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddOrderGiftRequestDto } from '../../../orders/http/dto/edit-order-request.dto';
import { FreeGiftBenefitDto } from '../../../promotions/http/dto/promotion.dto';
import { SetSalesDocumentSettingsDto } from './sales-document-settings.dto';

const errorsOf = async (cls: new () => object, plain: object): Promise<string[]> =>
  (await validate(plainToInstance(cls, plain))).map((e) => e.property);

describe('custom-price gift amount validation', () => {
  const cases: [string, new () => object, string, object][] = [
    ['settings', SetSalesDocumentSettingsDto, 'giftDocumentUnitPrice', { giftDocumentForm: 'custom-price' }],
    [
      'benefit',
      FreeGiftBenefitDto,
      'documentUnitPrice',
      { productId: 'p', variantId: 'v', quantity: 1, documentForm: 'custom-price' },
    ],
    [
      'operator gift',
      AddOrderGiftRequestDto,
      'documentUnitPrice',
      { variantId: 'v', quantity: 1, documentForm: 'custom-price' },
    ],
  ];

  it.each(cases)('should require the amount with custom-price (%s)', async (_n, cls, prop, base) => {
    expect(await errorsOf(cls, base)).toContain(prop);
  });

  it.each(cases)('should accept a positive amount with at most 2 decimals (%s)', async (_n, cls, prop, base) => {
    for (const ok of ['5', '5.5', '0.01', '120.25']) {
      expect(await errorsOf(cls, { ...base, [prop]: ok })).not.toContain(prop);
    }
  });

  it.each(cases)('should refuse zero, negative, 3 decimals and text (%s)', async (_n, cls, prop, base) => {
    for (const bad of ['0', '0.00', '-1', '1.234', 'abc', '']) {
      expect(await errorsOf(cls, { ...base, [prop]: bad })).toContain(prop);
    }
  });

  it.each(cases)('should not look at the amount for another form (%s)', async (_n, cls, prop, base) => {
    const other = { ...base, documentForm: 'omit', giftDocumentForm: 'omit' };
    expect(await errorsOf(cls, { ...other, [prop]: 'junk' })).not.toContain(prop);
  });
});
