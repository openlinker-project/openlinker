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
 * "unknown" and prefers `readConnectionCurrency(connection.config)` when
 * it is set — the pre-#3203 config-key path stays reachable, and now wins
 * over this resolver, as the operator-set mechanism (ADR-072 decision 4's
 * "absent must never collapse into a favourable match" rule, restated once
 * more here rather than guessed at a second time; see
 * `readConnectionCurrency`'s docblock for why the operator's own statement
 * must win over a fixed adapter assumption, #3159 review — BLOCKING).
 *
 * ## Why discovery is manifest-first
 *
 * `resolveAdapterMetadata` (metadata-only — constructs no adapter, resolves
 * no credentials, works even on a disabled connection) is checked before
 * `getCapabilityAdapter`, the #2229 `ResolveConcurrencyCeiling` rule:
 * "Discovery is manifest-first — building a capability adapter resolves
 * credentials, so `supportedCapabilities` is checked before construction."
 * Without it, a WooCommerce destination — whose `OfferManager` IS
 * supported (base-port-only, no declarer) — constructed TWO adapters per
 * resolution (`OfferManager`, then `ProductPublisher`) and repeated that on
 * every queue read with no cache in between (#3159 review, SUGGESTION).
 *
 * @module libs/core/src/listings/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTION_PORT_TOKEN,
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
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
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
  ) {}

  async resolveForConnection(connectionId: string): Promise<string | null> {
    const connection = await this.connections.get(connectionId).catch(() => null);
    if (!connection) {
      return null;
    }

    const marketplace = await this.tryResolve<OfferManagerPort>(
      connectionId,
      connection,
      'OfferManager',
    );
    if (marketplace !== null) {
      const declared = resolveOfferDestinationCurrency(marketplace);
      if (declared !== null) {
        return declared;
      }
    }

    const shop = await this.tryResolve<ShopProductManagerPort>(
      connectionId,
      connection,
      'ProductPublisher',
    );
    if (shop !== null) {
      const declared = await resolveShopDestinationCurrency(shop);
      if (declared !== null) {
        return declared;
      }
    }

    return null;
  }

  /**
   * Manifest-first (#3159 review, SUGGESTION): `resolveAdapterMetadata` is
   * checked before `getCapabilityAdapter` constructs anything, so a
   * connection whose adapter doesn't support (or hasn't enabled)
   * `capability` at all is filtered out here without resolving credentials
   * or building an adapter for it.
   */
  private async tryResolve<T>(
    connectionId: string,
    connection: Connection,
    capability: string,
  ): Promise<T | null> {
    const metadata = await this.integrationsService
      .resolveAdapterMetadata({
        platformType: connection.platformType,
        adapterKey: connection.adapterKey,
      })
      .catch(() => null);
    if (
      !metadata ||
      !metadata.supportedCapabilities.includes(capability) ||
      !connection.enabledCapabilities.includes(capability)
    ) {
      return null;
    }
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
