/**
 * GiftDocumentPreview tests (#3935)
 *
 * The figures are the ones of the approved cards, so a change to the mirrored
 * presenter that moves them fails here rather than on an operator's screen.
 *
 * @module apps/web/src/features/gift-documents
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { GiftDocumentPreview, previewLines } from './gift-document-preview';
import { GiftDocumentFormChoiceValues, parseGiftUnitPrice } from './lib/gift-lines';

afterEach(cleanup);

const prices = (form: Parameters<typeof previewLines>[0], customPrice?: string): number[] =>
  previewLines(form, customPrice, true, 'PLN').map((line) => line.price);

describe('previewLines', () => {
  it('should show the figures of the approved cards for every form', () => {
    expect(prices('priced-in')).toEqual([133.67, 48.12, 22.19]);
    expect(prices('technical-cent')).toEqual([149.98, 53.99, 0.01]);
    expect(prices('show-zero')).toEqual([149.99, 53.99, 0]);
    expect(prices('omit')).toEqual([149.99, 53.99]);
    expect(prices('custom-price', '2.50')).toEqual([147.49, 53.99, 2.5]);
    expect(prices('custom-price', '2,50')).toEqual([147.49, 53.99, 2.5]);
  });

  it('should total what was paid for every form that leaves the sum alone', () => {
    for (const form of GiftDocumentFormChoiceValues.filter((f) => f !== 'custom-price')) {
      const total = previewLines(form, undefined, true, 'PLN').reduce((sum, line) => sum + line.price, 0);
      expect(Math.round(total * 100)).toBe(20398);
    }
  });
});

describe('GiftDocumentPreview', () => {
  it('should say the total is unchanged when it is', () => {
    renderWithProviders(<GiftDocumentPreview form="priced-in" />);

    expect(screen.getByText('Total unchanged')).toBeInTheDocument();
  });
});

describe('parseGiftUnitPrice', () => {
  it('should read a typed amount with a comma or a dot and refuse anything else', () => {
    expect(parseGiftUnitPrice('2,50')).toBe(2.5);
    expect(parseGiftUnitPrice(' 3.1 ')).toBe(3.1);
    expect(parseGiftUnitPrice('0')).toBeNull();
    expect(parseGiftUnitPrice('abc')).toBeNull();
    expect(parseGiftUnitPrice('1,234')).toBeNull();
  });
});
