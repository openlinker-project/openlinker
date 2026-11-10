import { describe, expect, it } from 'vitest';

import type { InventoryMovementRow } from '../api/inventory-movements.types';
import { isMovementTypeFilterValue, operatorReasonText, presentMovementType } from './stock-movement-presentation';

const row = (overrides: Partial<InventoryMovementRow>): InventoryMovementRow =>
  ({ kind: 'movement', reason: 'gift', operatorReason: null, note: null, ...overrides }) as InventoryMovementRow;

describe('stock movement copy, gift (#3939)', () => {
  it('should label a gift movement as a gift, not as a sale', () => {
    expect(presentMovementType(row({}))).toMatchObject({ token: 'gift', label: 'Gift' });
  });

  it('should accept gift as a history filter value', () => {
    expect(isMovementTypeFilterValue('gift')).toBe(true);
  });

  it('should name the gift reason on a manual correction', () => {
    expect(operatorReasonText(row({ reason: 'manual_correction', operatorReason: 'gift' }))).toBe('Gift');
  });
});
