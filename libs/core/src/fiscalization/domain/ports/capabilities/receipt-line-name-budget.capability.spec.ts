/**
 * Receipt Line-Name Budget Capability - unit tests
 *
 * Pins the narrowing contract: an adapter that declares nothing must be
 * recognisable without calling it, so the reader falls back instead of
 * throwing on a missing method.
 *
 * @module libs/core/src/fiscalization/domain/ports/capabilities
 */
import { isReceiptLineNameBudget } from './receipt-line-name-budget.capability';
import type { ReceiptLineNameBudget } from './receipt-line-name-budget.capability';
import type { FiscalizationPort } from '../fiscalization.port';

describe('isReceiptLineNameBudget', () => {
  it('should narrow an adapter that declares a budget', () => {
    const declaring: FiscalizationPort & ReceiptLineNameBudget = {
      registerTransaction: jest.fn(),
      getReceiptLineNameMaxLength: () => 40,
    };
    expect(isReceiptLineNameBudget(declaring)).toBe(true);
  });

  it('should reject a base-port-only adapter', () => {
    const baseOnly: FiscalizationPort = { registerTransaction: jest.fn() };
    expect(isReceiptLineNameBudget(baseOnly)).toBe(false);
  });

  it('should reject a non-callable property of the same name', () => {
    const impostor = {
      registerTransaction: jest.fn(),
      getReceiptLineNameMaxLength: 40,
    } as unknown as FiscalizationPort;
    expect(isReceiptLineNameBudget(impostor)).toBe(false);
  });
});
