/**
 * Product Master Resolver Service
 *
 * Answers "which master does THIS product come from" for the content context
 * (#4068). The content services used to take the first ProductMaster
 * connection, which on an install with two masters (e.g. PrestaShop + Shoper)
 * asked one shop about the other shop's product - a 500 on read, and on publish
 * the description written into the wrong shop.
 *
 * The product's own master is the ProductMaster connection holding its
 * `Product` identifier mapping. The listing is `lazy`, so only the chosen
 * connection's adapter is ever constructed (no credentials resolved for the
 * others), through `getCapabilityAdapter`.
 *
 * @module libs/core/src/content/application/services
 * @implements {IProductMasterResolverService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN, type IIntegrationsService } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import { AmbiguousProductMasterException } from '../../domain/exceptions/ambiguous-product-master.exception';
import { NoProductMasterAdapterException } from '../../domain/exceptions/no-product-master-adapter.exception';
import type { IProductMasterResolverService } from './product-master-resolver.service.interface';

@Injectable()
export class ProductMasterResolverService implements IProductMasterResolverService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
  ) {}

  async resolve(productId: string, fieldKey: string): Promise<ProductMasterPort> {
    const mappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
    const claimants = new Set(mappings.map((mapping) => mapping.connectionId));

    const masters = await this.integrations.listCapabilityAdapters<ProductMasterPort>({
      capability: 'ProductMaster',
      lazy: true,
    });
    const owners = masters.filter((entry) => claimants.has(entry.connectionId));

    if (owners.length === 0) {
      throw new NoProductMasterAdapterException(productId, fieldKey);
    }
    if (owners.length > 1) {
      throw new AmbiguousProductMasterException(
        productId,
        owners.map((entry) => entry.connectionId),
      );
    }
    // The lazy listing only answered WHICH connection; its `adapter` is a
    // deferred construction, not the port. Build exactly this one.
    return this.integrations.getCapabilityAdapter<ProductMasterPort>(
      owners[0].connectionId,
      'ProductMaster',
    );
  }
}
