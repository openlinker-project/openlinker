import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { stockVariantFixture } from '../testing/stock-view-fixtures';
import { buildStockRows, type StockRowModel } from '../lib/stock-row';
import { StockCell } from './stock-cell';

afterEach(cleanup);

const variant = { id: 'v1', sku: 'KCN-WHT', attributes: null };

function rowFor(
  stock: ReturnType<typeof stockVariantFixture> | null,
  flags: { pending?: boolean; restricted?: boolean } = {},
): StockRowModel {
  return buildStockRows({
    variants: [variant],
    inventoryItems: [],
    stockByVariant: stock ? new Map([['v1', stock]]) : null,
    pending: flags.pending ?? false,
    restricted: flags.restricted ?? false,
    canAdjust: true,
    fallbackMasterName: null,
  }).get('v1')!;
}

describe('StockCell', () => {
  it('should put the number and the label on one line with a status badge', () => {
    render(<StockCell row={rowFor(stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', availableToPromise: 15, masterAvailable: 18 }))} />);
    expect(screen.getByTestId('stock-atp-KCN-WHT').parentElement).toHaveTextContent('15 to sell');
    expect(screen.getByText('In stock')).toBeInTheDocument();
  });

  it('should add the shop count and the reserved count on a second line only when something is reserved', () => {
    render(<StockCell row={rowFor(stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', heldCounted: 3 }))} />);
    expect(screen.getByTestId('stock-master-KCN-WHT')).toHaveTextContent('18 in PrestaShop');
    expect(screen.getByTestId('stock-held-KCN-WHT')).toHaveTextContent('3 reserved');
  });

  it('should leave the second line out when nothing is reserved', () => {
    render(<StockCell row={rowFor(stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', heldCounted: 0, availableToPromise: 18 }))} />);
    expect(screen.queryByTestId('stock-master-KCN-WHT')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stock-held-KCN-WHT')).not.toBeInTheDocument();
  });

  it('should show a dash and Not known, never 0, when what can be sold is not known', () => {
    render(
      <StockCell
        row={rowFor(stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', availableToPromise: null, provenance: 'unknown', heldCounted: null }))}
      />,
    );
    expect(screen.getByTestId('stock-atp-KCN-WHT')).toHaveTextContent('—');
    expect(screen.getByText('Not known')).toBeInTheDocument();
    expect(screen.getByTestId('stock-master-KCN-WHT')).toHaveTextContent('18 in PrestaShop');
  });

  it('should show Short by N in the error colour when more is reserved than the master holds', () => {
    const { container } = render(
      <StockCell row={rowFor(stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', masterAvailable: 2, heldCounted: 5, availableToPromise: 0 }))} />,
    );
    expect(screen.getByText('Short by 3')).toBeInTheDocument();
    expect(container.querySelector('.stock-cell--error')).not.toBeNull();
  });

  it('should show the master count first and a bar for what can be sold while the stock view loads', () => {
    render(<StockCell row={rowFor(null, { pending: true })} />);
    expect(screen.getByText('Loading stock')).toBeInTheDocument();
    expect(screen.getByTestId('stock-master-KCN-WHT')).toHaveTextContent('0 in the master');
  });

  it('should show the shop count without a badge for a session that may not read the stock view', () => {
    render(<StockCell row={rowFor(null, { restricted: true })} />);
    expect(screen.getByTestId('stock-atp-KCN-WHT')).toHaveTextContent('0');
    expect(screen.queryByText('Not known')).not.toBeInTheDocument();
  });
});
