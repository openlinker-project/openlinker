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
    const marketplace = await this.tryResolve<OfferManagerPort>(connectionId, 'OfferManager');
    if (marketplace !== null) {
      return this.view(resolveOfferDescriptionFormat(marketplace), 'OfferManager');
    }

    const shop = await this.tryResolve<ShopProductManagerPort>(connectionId, 'ProductPublisher');
    if (shop !== null) {
      return this.view(resolveShopDescriptionFormat(shop), 'ProductPublisher');
    }

    // Neither capability resolves: a disabled connection, a credential failure,
    // or a connection that publishes nothing. The editor still needs something
    // to author against, and saying so beats an error the operator cannot act on.
    this.logger.debug(
      `[description-format] no publishing capability resolved for connection ${connectionId}; using the conservative fallback`,
    );
    return { format: CONSERVATIVE_DESCRIPTION_FORMAT, declared: false, resolvedVia: null };
  }

  private view(
    format: DescriptionFormat,
    resolvedVia: 'OfferManager' | 'ProductPublisher',
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
