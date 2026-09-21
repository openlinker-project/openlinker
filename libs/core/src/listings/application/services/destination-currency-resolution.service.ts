/**
 * Destination Currency Resolution Service (#3203)
 *
 * Resolves a destination connection's real currency for the price-change
 * currency-mismatch guard (ADR-072 decision 4). `readConnectionCurrency`
 * (`price-change-block.types.ts`) reads a shared, source-only
 * `Connection.config.currency` key that (on the repo's default PrestaShop →
 * Allegro/Erli/WooCommerce topology) no destination form ever writes, so
 * every destination resolved `null` → `'destination-currency-unknown'` →
 * the automatic-apply bypass could never fire.
 *
 * ## Why it probes two capabilities
 *
 * The caller supplies a connection id and nothing else, so the destination
 * kind has to be DISCOVERED — the `resolveDestinationContext` /
 * `DescriptionFormatReadService` precedent, never a `platformType` switch.
 * A marketplace declares its currency on `OfferCurrencyDeclarer`
 * (`OfferManagerPort`); a shop declares it on `ShopCurrencyDeclarer`
 * (`ShopProductManagerPort`). Probing `OfferManager` first mirrors
 * `DescriptionFormatReadService`'s order, and is harmless either way since a
 * connection resolves to at most one publishing capability in practice.
 *
 * ## Why an undeclared/unresolvable currency is `null`, never a guess
 *
 * The caller (`price-change-block.types.ts`'s callers) treats `null` as
 * "unknown" and falls back to `readConnectionCurrency(connection.config)` —
 * the pre-#3203 config-key path stays reachable as a second, operator-set
 * mechanism (ADR-072 decision 4's "absent must never collapse into a
 * favourable match" rule, restated once more here rather than guessed at a
 * second time).
 *
 * @module libs/core/src/listings/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';

import {
  resolveOfferDestinationCurrency,
  resolveShopDestinationCurrency,
} from './destination-currency-resolution';
import type { IDestinationCurrencyResolutionService } from './destination-currency-resolution.service.interface';
import type { OfferManagerPort } from '../../domain/ports/offer-manager.port';
import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';

@Injectable()
export class DestinationCurrencyResolutionService
  implements IDestinationCurrencyResolutionService
{
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {}

  async resolveForConnection(connectionId: string): Promise<string | null> {
    const marketplace = await this.tryResolve<OfferManagerPort>(connectionId, 'OfferManager');
    if (marketplace !== null) {
      const declared = resolveOfferDestinationCurrency(marketplace);
      if (declared !== null) {
        return declared;
      }
    }

    const shop = await this.tryResolve<ShopProductManagerPort>(connectionId, 'ProductPublisher');
    if (shop !== null) {
      const declared = resolveShopDestinationCurrency(shop);
      if (declared !== null) {
        return declared;
      }
    }

    return null;
  }

  private async tryResolve<T>(connectionId: string, capability: string): Promise<T | null> {
    try {
      return await this.integrationsService.getCapabilityAdapter<T>(connectionId, capability);
    } catch {
      // Not supported / not enabled / unresolvable — all "this is not the
      // kind of destination we are looking for" from here, mirroring
      // `DescriptionFormatReadService.tryResolve`.
      return null;
    }
  }
}
