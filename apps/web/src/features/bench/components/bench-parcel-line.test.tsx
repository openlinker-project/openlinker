import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { BenchParcelLine } from '../api/bench-parcel.types';
import { BenchParcelLineRow } from './bench-parcel-line';

const line = (over: Partial<BenchParcelLine> = {}): BenchParcelLine => ({
  workLineId: 'w1',
  productVariantId: 'v1',
  name: 'Lyzeczka do kawy',
  sku: 'LYZ-KAW',
  ean: null,
  gtin: null,
  requiredQuantity: 1,
  verifiedQuantity: 0,
  imageUrl: null,
  attributes: null,
  binCode: null,
  weightGrams: null,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  ...over,
});

const row = (l: BenchParcelLine) =>
  renderWithProviders(
    <ul>
      <BenchParcelLineRow
        line={l}
        distinguishingAttributes={new Set<string>()}
        hasBins={false}
        open
        onConfirm={() => undefined}
      />
    </ul>,
  );

describe('BenchParcelLineRow gift slot (#3934)', () => {
  afterEach(cleanup);

  it('should tell the packer to include the gift, with no price or cost', () => {
    row(line({ bundle: { lineId: 'L1', name: 'Zestaw', giftSlot: true } }));
    expect(screen.getByTestId('bench-line-gift-LYZ-KAW')).toBeInTheDocument();
    expect(screen.getByText('Include the gift: Lyzeczka do kawy')).toBeInTheDocument();
    expect(screen.queryByText(/zł|PLN|Costs you/)).toBeNull();
  });

  it('should show an ordinary component by its own name', () => {
    row(line({ bundle: { lineId: 'L1', name: 'Zestaw', giftSlot: false } }));
    expect(screen.queryByTestId('bench-line-gift-LYZ-KAW')).toBeNull();
    expect(screen.getByText('Lyzeczka do kawy')).toBeInTheDocument();
  });
});
