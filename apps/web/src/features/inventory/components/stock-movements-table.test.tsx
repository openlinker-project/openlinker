import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { StockMovementsTable } from './stock-movements-table';
import type { InventoryMovementRow } from '../api/inventory-movements.types';

function row(overrides: Partial<InventoryMovementRow> = {}): InventoryMovementRow {
  return {
    kind: 'movement',
    id: 'm1',
    productId: 'ol_product_1',
    productVariantId: 'ol_variant_1',
    sku: 'KUB-350-BIA',
    productName: 'Kubek',
    locationId: null,
    sourceConnectionId: 'conn-1',
    reason: 'sale',
    status: 'applied',
    quantityDelta: -3,
    quantityBefore: 42,
    quantityAfter: 39,
    sourceKind: 'order',
    sourceRef: 'ol_order_1',
    operatorReason: null,
    note: null,
    refusalReason: null,
    refusalDetail: null,
    occurredAt: '2026-09-26T08:41:00.000Z',
    ...overrides,
  };
}

function renderTable(rows: InventoryMovementRow[], layout: 'variant' | 'global' = 'global'): void {
  render(
    <MemoryRouter>
      <StockMovementsTable
        rows={rows}
        connectionNames={new Map([['conn-1', 'Sklep Gorski']])}
        layout={layout}
        caption="Stock movements"
      />
    </MemoryRouter>,
  );
}

describe('StockMovementsTable', () => {
  afterEach(cleanup);

  it('should render an applied sale with delta, before and after and a linked order', () => {
    renderTable([row()]);
    const tr = screen.getByTestId('stock-movement-row');
    expect(tr).toHaveAttribute('data-movement-type', 'sale');
    expect(tr).toHaveAttribute('data-movement-status', 'applied');
    expect(within(tr).getByTestId('stock-movement-delta')).toHaveTextContent('-3');
    expect(within(tr).getByTestId('stock-movement-after')).toHaveTextContent('39');
    expect(within(tr).getByRole('link', { name: 'ol_order_1' })).toHaveAttribute('href', '/orders/ol_order_1');
    expect(within(tr).getByText('Sklep Gorski')).toBeInTheDocument();
  });

  it('should show a reservation as Promised with stock unchanged and no delta', () => {
    renderTable([
      row({
        kind: 'reservation',
        reason: null,
        status: 'held',
        quantityDelta: 3,
        quantityBefore: null,
        quantityAfter: null,
      }),
    ]);
    const tr = screen.getByTestId('stock-movement-row');
    expect(tr).toHaveAttribute('data-movement-type', 'reservation');
    expect(within(tr).getByTestId('stock-movement-promised')).toBeInTheDocument();
    expect(within(tr).getByText('Stock unchanged')).toBeInTheDocument();
    expect(within(tr).getByText('Promised 0 → 3')).toBeInTheDocument();
    expect(within(tr).queryByTestId('stock-movement-delta')).not.toBeInTheDocument();
  });

  it('should show a refused movement as Not applied with the adapter sentence', () => {
    renderTable([
      row({
        reason: 'return_restock',
        status: 'refused',
        quantityDelta: 1,
        quantityAfter: null,
        sourceKind: 'return',
        sourceRef: 'ol_return_1',
        refusalDetail: 'Master needs reauthorization.',
      }),
    ]);
    const tr = screen.getByTestId('stock-movement-row');
    expect(within(tr).getByTestId('stock-movement-after')).toHaveTextContent('Not applied');
    expect(within(tr).getByTestId('stock-movement-delta').className).toContain('stock-movement__delta--void');
    expect(within(tr).getByTestId('stock-movement-reason')).toHaveTextContent('Master needs reauthorization.');
    expect(within(tr).getByRole('link', { name: 'ol_return_1' })).toHaveAttribute('href', '/returns/ol_return_1');
  });

  it('should show an in-doubt movement with a question mark after', () => {
    renderTable([
      row({ reason: 'manual_correction', status: 'in_doubt', quantityAfter: null, sourceKind: 'operator', sourceRef: null, operatorReason: 'damaged', note: 'Broken in transit' }),
    ]);
    const tr = screen.getByTestId('stock-movement-row');
    expect(tr).toHaveAttribute('data-movement-type', 'manual');
    expect(within(tr).getByTestId('stock-movement-after')).toHaveTextContent('?');
    expect(within(tr).getByText('Damaged - Broken in transit')).toBeInTheDocument();
  });

  it('should drop the SKU column in the variant layout', () => {
    renderTable([row()], 'variant');
    expect(screen.queryByRole('columnheader', { name: 'SKU / variant' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Before → after' })).toBeInTheDocument();
  });
});
