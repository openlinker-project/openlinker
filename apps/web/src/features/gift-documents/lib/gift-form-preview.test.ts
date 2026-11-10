/**
 * Gift form preview tests (#3941)
 *
 * @module apps/web/src/features/gift-documents/lib
 */
import { describe, expect, it } from 'vitest';
import { GiftDocumentFormChoiceValues } from './gift-lines';
import {
  CARD_SAMPLE_PAID_TOTAL,
  cardSampleLines,
  parseGiftUnitPrice,
  previewGiftForm,
  sampleOrderLines,
  SAMPLE_BOOK_PRICE,
} from './gift-form-preview';

const lines = sampleOrderLines('Book', 'Mug');

describe('previewGiftForm', () => {
  it('should total what was paid for every form, with and without zero accepted', () => {
    for (const form of GiftDocumentFormChoiceValues) {
      for (const accepts of [true, false]) {
        expect(previewGiftForm(lines, form, accepts).totalMinor).toBe(SAMPLE_BOOK_PRICE * 100);
      }
    }
  });

  it('should carry the gift at 0.01 and take the cent from the book for technical-cent', () => {
    const { lines: out } = previewGiftForm(lines, 'technical-cent', false);
    expect(out.map((l) => [l.name, l.unitPriceGross])).toEqual([
      ['Book', 99.99],
      ['Mug', 0.01],
    ]);
  });

  it('should price the gift in proportionally at its own rate', () => {
    const { lines: out } = previewGiftForm(lines, 'priced-in', false);
    expect(out.find((l) => l.name === 'Mug')?.unitPriceGross).toBeCloseTo(16.67);
    expect(out.find((l) => l.name === 'Mug')?.taxRate).toBe('23');
  });

  it('should show zero only where it is accepted and fall back to a cent where it is not', () => {
    expect(previewGiftForm(lines, 'show-zero', true).lines.at(-1)?.unitPriceGross).toBe(0);
    expect(previewGiftForm(lines, 'show-zero', false).lines.at(-1)?.unitPriceGross).toBeCloseTo(0.01);
  });

  it('should leave the gift off the document when omitted', () => {
    expect(previewGiftForm(lines, 'omit', true).lines.map((l) => l.name)).toEqual(['Book']);
  });
});

describe('card sample (#3935)', () => {
  const names = { coffee: 'Coffee', tea: 'Tea', mug: 'Mug' };
  const values = (form: Parameters<typeof previewGiftForm>[1], price?: number): number[] =>
    previewGiftForm(cardSampleLines(names, price), form, true).lines.map((l) => l.unitPriceGross);

  it('should show the figures of the approved cards for every form', () => {
    expect(values('priced-in')).toEqual([133.67, 48.12, 22.19]);
    expect(values('technical-cent')).toEqual([149.98, 53.99, 0.01]);
    expect(values('show-zero')).toEqual([149.99, 53.99, 0]);
    expect(values('omit')).toEqual([149.99, 53.99]);
    expect(values('custom-price', 2.5)).toEqual([147.49, 53.99, 2.5]);
  });

  it('should total what was paid for every form', () => {
    for (const form of ['priced-in', 'technical-cent', 'show-zero', 'omit'] as const) {
      expect(previewGiftForm(cardSampleLines(names), form, true).totalMinor).toBe(
        Math.round(CARD_SAMPLE_PAID_TOTAL * 100),
      );
    }
  });

  it('should read a typed amount with a comma or a dot and refuse anything else', () => {
    expect(parseGiftUnitPrice('2,50')).toBe(2.5);
    expect(parseGiftUnitPrice(' 3.1 ')).toBe(3.1);
    expect(parseGiftUnitPrice('0')).toBeNull();
    expect(parseGiftUnitPrice('abc')).toBeNull();
    expect(parseGiftUnitPrice('1,234')).toBeNull();
  });
});
