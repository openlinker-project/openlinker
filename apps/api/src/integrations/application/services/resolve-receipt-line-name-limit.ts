/**
 * Receipt line-name budget resolution (#3914, ADR-082)
 *
 * Asks every active fiscalization connection how many characters of a line
 * name its registering mechanism compares (`ReceiptLineNameBudget`, the ADR-046
 * shape) and folds the answers with the pure `combineReceiptLineNameLimits`.
 * Core keeps no regime number; this is the one place the API reads what the
 * adapters declare.
 *
 * It never throws. The budget only shapes how long a delivery name may be, so
 * a fiscalization connection that cannot be constructed (bad credentials, a
 * disabled plugin) must not block saving an unrelated order-source connection:
 * that connection simply declares nothing, and with nothing declared the
 * conservative fallback applies.
 *
 * @module apps/api/src/integrations/application/services
 */
import {
  isReceiptLineNameBudget,
  type FiscalizationPort,
} from '@openlinker/core/fiscalization';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  combineReceiptLineNameLimits,
  type ReceiptLineNameLimit,
} from '@openlinker/core/sales-documents';
import type { LoggerPort } from '@openlinker/shared/logging';

export async function resolveReceiptLineNameLimit(
  integrations: IIntegrationsService,
  logger: LoggerPort,
): Promise<ReceiptLineNameLimit> {
  let entries: ReadonlyArray<{ connectionId: string; adapter: unknown }>;
  try {
    // Lazy, so a connection is constructed only when its declaration is read
    // and one failing construction cannot abort the whole listing.
    entries = await integrations.listCapabilityAdapters<FiscalizationPort>({
      capability: 'Fiscalization',
      lazy: true,
    });
  } catch (error) {
    logger.warn(
      `Could not list fiscalization connections for the receipt line-name budget; using the fallback: ${String(error)}`,
    );
    return combineReceiptLineNameLimits([]);
  }

  const declared: number[] = [];
  for (const entry of entries ?? []) {
    try {
      // A lazy entry's `adapter` is the memoized construction Promise.
      const adapter = (await entry.adapter) as FiscalizationPort;
      if (isReceiptLineNameBudget(adapter)) declared.push(adapter.getReceiptLineNameMaxLength());
    } catch (error) {
      logger.warn(
        `Fiscalization connection ${entry.connectionId} did not report a receipt line-name budget: ${String(error)}`,
      );
    }
  }
  return combineReceiptLineNameLimits(declared);
}
