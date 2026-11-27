import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { BenchParcelLine } from '../api/bench-parcel.types';
import { BenchSourceChange } from './bench-source-change';

const line = (overrides: Partial<BenchParcelLine> = {}): BenchParcelLine => ({
  workLineId: 'wl-1',
  productVariantId: 'v-1',
  name: 'Ceramic mug 350 ml',
  sku: 'MUG-350',
  ean: null,
  gtin: null,
  requiredQuantity: 2,
  verifiedQuantity: 2,
  imageUrl: null,
  attributes: null,
  binCode: 'A-03-2',
  weightGrams: null,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  ...overrides,
});

describe('BenchSourceChange (#3961)', () => {
  it('should name how many units to take out, of what, and from which shelf', () => {
    render(<BenchSourceChange sourceChange={{ takeOut: [{ workLineId: 'wl-1', units: 1 }] }} lines={[line()]} />);

    const card = screen.getByTestId('bench-source-change');
    expect(card).toHaveTextContent('Take out');
    expect(card).toHaveTextContent('1');
    expect(card).toHaveTextContent('Ceramic mug 350 ml');
    expect(card).toHaveTextContent('shelf A-03-2');
  });

  it('should say "the shelf" when no bin code was recorded', () => {
    render(
      <BenchSourceChange
        sourceChange={{ takeOut: [{ workLineId: 'wl-1', units: 2 }] }}
        lines={[line({ binCode: null })]}
      />,
    );

    expect(screen.getByTestId('bench-source-change')).toHaveTextContent('put them back on the shelf');
  });

  it('should render nothing when nothing has to come out', () => {
    const { container } = render(<BenchSourceChange sourceChange={{ takeOut: [] }} lines={[line()]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('should confirm the line the packer took the units out of', async () => {
    const onTakenOut = vi.fn();
    render(
      <BenchSourceChange
        sourceChange={{ takeOut: [{ workLineId: 'wl-1', units: 1 }] }}
        lines={[line()]}
        onTakenOut={onTakenOut}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Done, I took it out' }));

    expect(onTakenOut).toHaveBeenCalledWith('wl-1');
  });

  it('should show no button to a session that may not confirm', () => {
    render(<BenchSourceChange sourceChange={{ takeOut: [{ workLineId: 'wl-1', units: 1 }] }} lines={[line()]} />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
