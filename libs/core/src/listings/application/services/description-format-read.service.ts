/**
 * Description Format Read Service
 *
 * Resolves the `DescriptionFormat` a connection declares (ADR-046) for the
 * frontend, so the editor is composed from the destination's contract rather
 * than from a table the frontend maintains. One read, no live platform call -
 * the declaration is a pure adapter method.
 *
 * ## Why it probes two capabilities
 *
 * The caller supplies a connection id and nothing else, so the destination kind
 * has to be DISCOVERED, exactly as `resolveDestinationContext` does for the MCP
 * tools and `resolveScope` for the taxonomy reads. A marketplace declares the
 * format on the `OfferFieldUpdater` sub-capability; a shop declares it on
 * `ShopProductManagerPort` itself. Probing in that order, never a `platformType`
 * switch.
 *
 * ## Why the fallback is resolved HERE and not in the browser
 *
 * A connection that declares nothing still gets a usable format, and the caller
 * is told (`declared: false`) so the UI can say so. Resolving it server-side is
 * what keeps the "the frontend holds no destination knowledge" property true: if
 * the browser had to supply a default, that default would be destination
 * knowledge living in the frontend - the alternative ADR-046 rejects.
 *
 * @module libs/core/src/listings/application/services
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';

import {
  resolveOfferDescriptionFormat,
  resolveShopDescriptionFormat,
} from './description-format-resolution';
import {
  CONSERVATIVE_DESCRIPTION_FORMAT,
  type DescriptionFormat,
  type DescriptionFormatSource,
} from '../../domain/types/description-format.types';
import type {
  DescriptionFormatView,
  IDescriptionFormatReadService,
} from './description-format-read.service.interface';
import type { OfferManagerPort } from '../../domain/ports/offer-manager.port';
import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';

@Injectable()
export class DescriptionFormatReadService implements IDescriptionFormatReadService {
  private readonly logger = new Logger(DescriptionFormatReadService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {}

  async getForConnection(connectionId: string): Promise<DescriptionFormatView> {
    // A DECLARED format wins over a fallback, whichever capability answers.
    //
    // Probing `OfferManager` first and accepting whatever it returns was wrong
    // for a real, operator-reachable state: a WooCommerce connection with stock
    // write-back enabled (#1498) resolves `OfferManager` to a base-port-only
    // adapter that declares nothing, so the editor was handed the conservative
    // seven-tag subset - and told "this destination has not declared its format"
    // - for a shop whose own declaration allows tables, links and h3, and whose
    // publish path uses that real declaration. The operator lost controls the
    // destination accepts, on a false statement about their own connection.
    const marketplace = await this.tryResolve<OfferManagerPort>(connectionId, 'OfferManager');
    const marketplaceFormat =
      marketplace === null ? null : resolveOfferDescriptionFormat(marketplace);
    if (marketplaceFormat !== null && marketplaceFormat !== CONSERVATIVE_DESCRIPTION_FORMAT) {
      return this.view(marketplaceFormat, 'OfferManager');
    }

    const shop = await this.tryResolve<ShopProductManagerPort>(connectionId, 'ProductPublisher');
    if (shop !== null) {
      return this.view(resolveShopDescriptionFormat(shop), 'ProductPublisher');
    }

    // A marketplace that resolved but declared nothing: the fallback is the
    // answer, and naming the capability that produced it is still useful.
    if (marketplaceFormat !== null) {
      this.logger.warn(
        `[description-format] connection ${connectionId} resolves OfferManager but declares no description format; using the conservative fallback`,
      );
      return this.view(marketplaceFormat, 'OfferManager');
    }

    // Neither capability resolves. This is NOT the same as "declared nothing" -
    // it is a disabled connection, a credential failure, or an id that matches
    // no publishing destination - so it is reported as unresolved (`resolvedVia:
    // null`) rather than as an undeclared destination, and logged at `warn`
    // because it is a configuration state an operator can act on.
    this.logger.warn(
      `[description-format] no publishing capability resolved for connection ${connectionId}; using the conservative fallback`,
    );
    return { format: CONSERVATIVE_DESCRIPTION_FORMAT, declared: false, resolvedVia: null };
  }

  private view(
    format: DescriptionFormat,
    resolvedVia: DescriptionFormatSource,
  ): DescriptionFormatView {
    // Reference equality is the signal: `resolve*DescriptionFormat` returns the
    // shared constant when the adapter declared nothing, so this needs no
    // second probe of the adapter.
    return { format, declared: format !== CONSERVATIVE_DESCRIPTION_FORMAT, resolvedVia };
  }

  private async tryResolve<T>(connectionId: string, capability: string): Promise<T | null> {
    try {
      return await this.integrationsService.getCapabilityAdapter<T>(connectionId, capability);
    } catch {
      // Not supported / not enabled / unresolvable - all "this is not the kind
      // of destination we are looking for" from here.
      return null;
    }
  }
}
