/**
 * Subiekt Line Mapper (#753)
 *
 * Maps neutral `InvoiceLine[]` to bridge-native `BridgeLine[]`. Both shapes
 * carry `name`, `quantity`, `unitPriceGross`, `taxRate`, so this is a 1:1
 * field copy (verified against subiekt-bridge.types.ts).
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { InvoiceLine } from '@openlinker/core/invoicing';
import type { BridgeLine } from '../../bridge/subiekt-bridge.types';

export function toBridgeLines(lines: InvoiceLine[]): BridgeLine[] {
  return lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPriceGross: line.unitPriceGross,
    taxRate: line.taxRate,
  }));
}
