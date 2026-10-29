import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    actorUserId: null,
    actorName: null,
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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should label an order link with the order number and keep the id out of the text', () => {
    renderTable([row({ sourceLabel: 'ORD-1042' })]);
    const link = screen.getByRole('link', { name: 'ORD-1042' });
    expect(link).toHaveAttribute('href', '/orders/ol_order_1');
    expect(screen.queryByText('ol_order_1')).not.toBeInTheDocument();
  });

  it('should label a return link with the return number or fall back to Return', () => {
    renderTable([row({ sourceKind: 'return', sourceRef: 'ol_return_9', sourceLabel: 'RET-7' })]);
    expect(screen.getByRole('link', { name: 'RET-7' })).toHaveAttribute('href', '/returns/ol_return_9');
    cleanup();
    renderTable([row({ sourceKind: 'return', sourceRef: 'ol_return_9' })]);
    const fallback = screen.getByRole('link', { name: 'Return' });
    expect(fallback).toHaveAttribute('title', 'ol_return_9');
  });

  it('should carry the row test ids on mobile cards and the list root', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query.includes('max-width'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    renderTable([row({ status: 'refused' })]);
    expect(screen.getByTestId('stock-movements-table').tagName).toBe('UL');
    const card = screen.getByTestId('stock-movement-row');
    expect(card).toHaveAttribute('data-movement-type', 'sale');
    expect(card).toHaveAttribute('data-movement-status', 'refused');
  });

  it('should render an applied sale with delta, before and after and a linked order', () => {
    renderTable([row()]);
    const tr = screen.getByTestId('stock-movement-row');
    expect(tr).toHaveAttribute('data-movement-type', 'sale');
    expect(tr).toHaveAttribute('data-movement-status', 'applied');
    expect(within(tr).getByTestId('stock-movement-delta')).toHaveTextContent('-3');
    expect(within(tr).getByTestId('stock-movement-after')).toHaveTextContent('39');
    expect(within(tr).getByRole('link', { name: 'Order' })).toHaveAttribute('href', '/orders/ol_order_1');
    expect(within(tr).getByText('Sklep Gorski')).toBeInTheDocument();
  });

  it('should show a reservation as Reserved with stock unchanged and no delta', () => {
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
    expect(within(tr).getByText('Reserved 0 → 3')).toBeInTheDocument();
    expect(within(tr).getByTestId('stock-movement-promised')).toHaveTextContent('Reserved');
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
      row({ reason: 'manual_correction', status: 'in_doubt', quantityAfter: null, sourceKind: 'operator', sourceRef: null, actorUserId: 'u1', actorName: 'Anna Wisniewska', operatorReason: 'damaged', note: 'Broken in transit' }),
    ]);
    const tr = screen.getByTestId('stock-movement-row');
    expect(tr).toHaveAttribute('data-movement-type', 'manual');
    expect(within(tr).getByTestId('stock-movement-after')).toHaveTextContent('?');
    expect(within(tr).getByText('Damaged - Broken in transit')).toBeInTheDocument();
    expect(within(tr).getByText('Anna Wisniewska')).toBeInTheDocument();
  });

  it('should show an applied movement with no earlier count as a new position, not a question mark', () => {
    renderTable([row({ reason: 'master_sync', status: 'applied', quantityBefore: null, quantityAfter: 1000, quantityDelta: 1000 })]);
    const tr = screen.getByTestId('stock-movement-row');
    expect(within(tr).getByTestId('stock-movement-before')).toHaveTextContent('new');
    expect(within(tr).getByTestId('stock-movement-after')).toHaveTextContent('1000');
    expect(tr).not.toHaveTextContent('?');
  });

  it('should keep the question mark for an applied movement with neither count', () => {
    renderTable([row({ reason: 'master_sync', status: 'applied', quantityBefore: null, quantityAfter: null })]);
    expect(within(screen.getByTestId('stock-movement-row')).getByTestId('stock-movement-before')).toHaveTextContent('?');
  });

  it('should keep the question mark for an in-doubt movement with no earlier count', () => {
    renderTable([row({ reason: 'manual_correction', status: 'in_doubt', quantityBefore: null, quantityAfter: null, sourceKind: 'operator', sourceRef: null })]);
    const tr = screen.getByTestId('stock-movement-row');
    expect(within(tr).getByTestId('stock-movement-before')).toHaveTextContent('?');
    expect(within(tr).getByTestId('stock-movement-after')).toHaveTextContent('?');
  });

  it('should name an operator whose account no longer exists as Unknown user', () => {
    renderTable([row({ reason: 'manual_correction', sourceKind: 'operator', sourceRef: null, actorUserId: 'gone', actorName: null })]);
    expect(screen.getByText('Unknown user')).toBeInTheDocument();
  });

  it('should drop the SKU column in the variant layout', () => {
    renderTable([row()], 'variant');
    expect(screen.queryByRole('columnheader', { name: 'SKU / variant' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Before → after' })).toBeInTheDocument();
  });
});
