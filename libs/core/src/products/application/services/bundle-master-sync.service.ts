/**
 * Bundle Master Sync Service (#3932)
 *
 * Reads a bundle's composition from the product master (through the optional
 * `BundleReader` capability), maps the master's identifiers to OL variants and
 * hands the result to `BundleDefinitionService`, which owns every rule a
 * definition must satisfy (nesting, positive quantities, versioning).
 *
 * @module libs/core/src/products/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CapabilityNotSupportedException,
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { BundleMasterSyncRefusedError } from '../../domain/exceptions/bundle-definition.errors';
import type { ProductMasterPort } from '../../domain/ports/product-master.port';
import { isBundleReader } from '../../domain/ports/capabilities/bundle-reader.capability';
import type { BundleDefinition } from '../../domain/types/bundle.types';
import {
  BUNDLE_DEFINITION_SERVICE_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
} from '../../products.tokens';
import { ProductVariantRepositoryPort } from '../../domain/ports/product-variant-repository.port';
import { IBundleDefinitionService } from './bundle-definition.service.interface';
import type {
  BundleReadingMaster,
  IBundleMasterSyncService,
  MasterBundleComposition,
} from './bundle-master-sync.service.interface';

interface MasterBinding {
  connectionId: string;
  externalProductId: string;
  adapter: ProductMasterPort;
}

@Injectable()
export class BundleMasterSyncService implements IBundleMasterSyncService {
  private readonly logger = new Logger(BundleMasterSyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(PRODUCT_VARIANT_REPOSITORY_TOKEN)
    private readonly variants: ProductVariantRepositoryPort,
    @Inject(BUNDLE_DEFINITION_SERVICE_TOKEN)
    private readonly bundles: IBundleDefinitionService
  ) {}

  async findBundleReadingMaster(variantId: string): Promise<BundleReadingMaster | null> {
    let binding: MasterBinding | null;
    try {
      binding = await this.resolveMaster(variantId);
    } catch (error) {
      // A read-only probe (it decides whether to offer the action) must not 500
      // a page; previewComposition / syncFromMaster surface the same failure.
      if (error instanceof BundleMasterSyncRefusedError && error.reason === 'master-unavailable') {
        this.logger.warn(`Bundle master probe for variant ${variantId}: ${error.message}`);
        return null;
      }
      throw error;
    }
    if (binding === null || !isBundleReader(binding.adapter)) {
      return null;
    }
    const { connection } = await this.integrations.getAdapter(binding.connectionId);
    return { connectionId: binding.connectionId, connectionName: connection.name };
  }

  async previewComposition(variantId: string): Promise<MasterBundleComposition> {
    const binding = await this.resolveMaster(variantId);
    if (binding === null) {
      throw new BundleMasterSyncRefusedError(
        'no-master',
        `No product master connection claims variant ${variantId}`
      );
    }
    if (!isBundleReader(binding.adapter)) {
      throw new BundleMasterSyncRefusedError(
        'master-cannot-read-bundles',
        'This product master cannot read bundle compositions'
      );
    }
    const composition = await binding.adapter.readBundleComposition(binding.externalProductId);
    if (composition === null || composition.components.length === 0) {
      throw new BundleMasterSyncRefusedError(
        'not-a-bundle-in-master',
        `Product ${binding.externalProductId} is not a pack in the master`
      );
    }

    const unmapped: string[] = [];
    const components: MasterBundleComposition['components'] = [];
    for (const component of composition.components) {
      const internalVariantId = await this.identifierMapping.getInternalId(
        CORE_ENTITY_TYPE.ProductVariant,
        component.externalVariantId,
        binding.connectionId
      );
      if (internalVariantId === null) {
        unmapped.push(component.externalProductId);
        continue;
      }
      const [variant] = await this.variants.findByIdIn([internalVariantId]);
      if (variant === undefined) {
        unmapped.push(component.externalProductId);
        continue;
      }
      components.push({
        variantId: internalVariantId,
        productId: variant.productId,
        quantity: component.quantity,
      });
    }
    if (unmapped.length > 0) {
      throw new BundleMasterSyncRefusedError(
        'component-unmapped',
        `Component product(s) ${unmapped.join(', ')} are not synced into OpenLinker yet`,
        unmapped
      );
    }
    return { connectionId: binding.connectionId, components };
  }

  async syncFromMaster(variantId: string): Promise<BundleDefinition> {
    const preview = await this.previewComposition(variantId);
    const inputs = preview.components.map((c) => ({ variantId: c.variantId, quantity: c.quantity }));
    // The definition service refuses nesting and versions the write; it never
    // overwrites a stored version, so open orders keep the composition they froze.
    const existing = await this.bundles.get(variantId);
    return existing === null
      ? this.bundles.create(variantId, inputs)
      : this.bundles.update(variantId, inputs);
  }

  /** The master connection that maps this variant, with its adapter and the product's id there. */
  private async resolveMaster(variantId: string): Promise<MasterBinding | null> {
    const [variant] = await this.variants.findByIdIn([variantId]);
    if (variant === undefined) {
      return null;
    }
    const variantMappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.ProductVariant,
      variantId
    );
    const productMappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      variant.productId
    );
    let unavailable: Error | null = null;
    for (const mapping of variantMappings) {
      const productMapping = productMappings.find((m) => m.connectionId === mapping.connectionId);
      if (productMapping === undefined) {
        continue;
      }
      try {
        const adapter = await this.integrations.getCapabilityAdapter<ProductMasterPort>(
          mapping.connectionId,
          'ProductMaster'
        );
        return {
          connectionId: mapping.connectionId,
          externalProductId: productMapping.externalId,
          adapter,
        };
      } catch (error) {
        // A connection without ProductMaster (a marketplace that merely maps the
        // variant) is not the master; keep looking. Anything else (credentials,
        // transport) is a master we could not reach, which is not "no master".
        if (error instanceof CapabilityNotSupportedException) {
          continue;
        }
        unavailable ??= error instanceof Error ? error : new Error(String(error));
      }
    }
    if (unavailable !== null) {
      throw new BundleMasterSyncRefusedError(
        'master-unavailable',
        `The product master could not be reached: ${unavailable.message}`
      );
    }
    return null;
  }
}
