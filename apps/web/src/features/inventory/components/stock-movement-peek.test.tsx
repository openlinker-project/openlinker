import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { InventoryMovementRow } from '../api/inventory-movements.types';
import { StockMovementPeek } from './stock-movement-peek';

afterEach(cleanup);

const baseRow: InventoryMovementRow = {
  kind: 'movement',
  id: 'm1',
  productId: 'p',
  productVariantId: 'v',
  sku: 'KUB-350',
  productName: 'Cup',
  locationId: null,
  sourceConnectionId: null,
  reason: 'gift',
  status: 'applied',
  quantityDelta: -1,
  quantityBefore: 8,
  quantityAfter: 7,
  sourceKind: 'order',
  sourceRef: 'ol_order_1',
  sourceLabel: 'PS-7748',
  operatorReason: null,
  note: null,
  actorUserId: null,
  actorName: null,
  refusalReason: null,
  refusalDetail: null,
  occurredAt: '2026-11-10T10:53:00.000Z',
};

function renderPeek(row: InventoryMovementRow): void {
  renderWithProviders(
    <StockMovementPeek
      row={row}
      position={1}
      count={1}
      connectionNames={new Map()}
      onNavigate={() => undefined}
      onOpenChange={() => undefined}
    />
  );
}

describe('StockMovementPeek', () => {
  it('should say where a promotion gift came from and link to the promotion', () => {
    renderPeek({
      ...baseRow,
      gift: { source: 'ol-rule', promotionId: 'p1', promotionName: 'Cup promo' },
    });

    expect(screen.getByTestId('stock-movement-peek-gift')).toHaveTextContent(
      'A promotion in OpenLinker added it.'
    );
    expect(screen.getByRole('link', { name: 'See promotion' })).toHaveAttribute(
      'href',
      '/automations/gifts/p1'
    );
    expect(screen.getByTestId('stock-movement-peek-source')).toHaveTextContent(
      'Promotion: Cup promo'
    );
  });

  it('should offer only the order for a gift added by hand', () => {
    renderPeek({
      ...baseRow,
      gift: { source: 'operator', promotionId: null, promotionName: null },
    });

    expect(screen.queryByRole('link', { name: 'See promotion' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open order' })).toHaveAttribute(
      'href',
      '/orders/ol_order_1'
    );
  });

  it('should show no gift callout on an ordinary movement', () => {
    renderPeek({ ...baseRow, reason: 'sale', gift: null });

    expect(screen.queryByTestId('stock-movement-peek-gift')).toBeNull();
  });
});
