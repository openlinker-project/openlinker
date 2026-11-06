/**
 * Bundle Definition Service (#3607)
 *
 * Owns the rules a definition must satisfy before it is written: every variant
 * exists, quantities are positive integers, and nesting is refused in both
 * directions (a bundle cannot hold a bundle; a component cannot become one).
 *
 * @module libs/core/src/products/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import { BundleDefinitionRepositoryPort } from '../../domain/ports/bundle-definition-repository.port';
import { ProductVariantRepositoryPort } from '../../domain/ports/product-variant-repository.port';
import {
  BundleDefinitionAlreadyExistsError,
  BundleDefinitionInvalidError,
  BundleDefinitionNotFoundError,
  BundleNestingError,
} from '../../domain/exceptions/bundle-definition.errors';
import type {
  BundleComponent,
  BundleDefinition,
  BundleDefinitionVersion,
  MultipackConfirmation,
} from '../../domain/types/bundle.types';
import {
  BUNDLE_DEFINITION_REPOSITORY_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
} from '../../products.tokens';
import type { BundleComponentInput, IBundleDefinitionService } from './bundle-definition.service.interface';

@Injectable()
export class BundleDefinitionService implements IBundleDefinitionService {
  constructor(
    @Inject(BUNDLE_DEFINITION_REPOSITORY_TOKEN)
    private readonly bundles: BundleDefinitionRepositoryPort,
    @Inject(PRODUCT_VARIANT_REPOSITORY_TOKEN)
    private readonly variants: ProductVariantRepositoryPort
  ) {}

  async create(variantId: string, components: BundleComponentInput[]): Promise<BundleDefinition> {
    return this.write(variantId, components, 'create');
  }

  async update(variantId: string, components: BundleComponentInput[]): Promise<BundleDefinition> {
    return this.write(variantId, components, 'update');
  }

  async delete(variantId: string): Promise<void> {
    const retired = await this.bundles.retire(variantId);
    if (!retired) {
      throw new BundleDefinitionNotFoundError(variantId);
    }
  }

  async get(variantId: string): Promise<BundleDefinition | null> {
    const [definition] = await this.bundles.findCurrentByVariantIds([variantId]);
    return definition ?? null;
  }

  list(): Promise<BundleDefinition[]> {
    return this.bundles.listCurrent();
  }

  findCurrentByVariantIds(variantIds: readonly string[]): Promise<BundleDefinition[]> {
    return this.bundles.findCurrentByVariantIds(variantIds);
  }

  findCurrentContainingComponents(variantIds: readonly string[]): Promise<BundleDefinition[]> {
    return this.bundles.findCurrentContainingAnyComponent(variantIds);
  }

  findConfirmedMultipacks(
    pairs: readonly MultipackConfirmation[]
  ): Promise<MultipackConfirmation[]> {
    return this.bundles.findConfirmedMultipacks(pairs);
  }

  async confirmMultipack(
    confirmation: MultipackConfirmation,
    confirmedByUserId: string | null
  ): Promise<void> {
    if (!Number.isInteger(confirmation.packQuantity) || confirmation.packQuantity < 2) {
      throw new BundleDefinitionInvalidError('A multipack needs a pack quantity of 2 or more');
    }
    const [variant] = await this.variants.findByIdIn([confirmation.variantId]);
    if (variant === undefined) {
      throw new BundleDefinitionInvalidError(`Variant ${confirmation.variantId} does not exist`);
    }
    await this.bundles.confirmMultipack(confirmation, confirmedByUserId);
  }

  history(variantId: string): Promise<BundleDefinitionVersion[]> {
    return this.bundles.findHistory(variantId);
  }

  /**
   * Validate, then write under a per-variant advisory lock covering the bundle
   * and every component: the existence and nesting checks are reads, so without
   * the lock two concurrent saves (A holds B, B holds A) would each pass them.
   */
  private async write(
    variantId: string,
    inputs: BundleComponentInput[],
    mode: 'create' | 'update'
  ): Promise<BundleDefinition> {
    return this.bundles.withVariantsLocked([variantId, ...inputs.map((i) => i.variantId)], () =>
      this.writeLocked(variantId, inputs, mode)
    );
  }

  private async writeLocked(
    variantId: string,
    inputs: BundleComponentInput[],
    mode: 'create' | 'update'
  ): Promise<BundleDefinition> {
    const [existing] = await this.bundles.findCurrentByVariantIds([variantId]);
    if (mode === 'create' && existing !== undefined) {
      throw new BundleDefinitionAlreadyExistsError(variantId);
    }
    if (mode === 'update' && existing === undefined) {
      throw new BundleDefinitionNotFoundError(variantId);
    }
    if (inputs.length === 0) {
      throw new BundleDefinitionInvalidError('A bundle needs at least one component');
    }
    for (const input of inputs) {
      if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        throw new BundleDefinitionInvalidError(
          `Component ${input.variantId} needs a positive whole quantity`
        );
      }
      if (input.variantId === variantId) {
        throw new BundleNestingError('component-is-self', variantId, input.variantId);
      }
    }

    const componentIds = [...new Set(inputs.map((i) => i.variantId))];
    const found = await this.variants.findByIdIn([variantId, ...componentIds]);
    const byId = new Map(found.map((v) => [v.id, v]));
    for (const id of [variantId, ...componentIds]) {
      if (!byId.has(id)) {
        throw new BundleDefinitionInvalidError(`Variant ${id} does not exist`);
      }
    }

    const nestedComponents = await this.bundles.findCurrentByVariantIds(componentIds);
    if (nestedComponents.length > 0) {
      throw new BundleNestingError('component-is-bundle', variantId, nestedComponents[0].variantId);
    }
    const containers = (await this.bundles.findCurrentContainingComponent(variantId)).filter(
      (d) => d.variantId !== variantId
    );
    if (containers.length > 0) {
      throw new BundleNestingError('variant-is-component', variantId, containers[0].variantId);
    }

    // One variant, one component: stock, reservations and the expansion all
    // treat a variant listed twice as ONE pool, so the stored form says so.
    // Quantities add. The merged slot stays a gift only when EVERY merged slot
    // was one (the same rule `expandBundleLines` applies), because a paid unit
    // folded into a gift slot must not be presented as free.
    const merged = new Map<string, BundleComponent>();
    for (const input of inputs) {
      const existing = merged.get(input.variantId);
      if (existing === undefined) {
        const variant = byId.get(input.variantId);
        const component: BundleComponent = {
          variantId: input.variantId,
          productId: (variant as { productId: string }).productId,
          quantity: input.quantity,
        };
        if (input.giftSlot === true) {
          component.giftSlot = true;
        }
        merged.set(input.variantId, component);
      } else {
        existing.quantity += input.quantity;
        if (input.giftSlot !== true) {
          delete existing.giftSlot;
        }
      }
    }
    const components = [...merged.values()];
    return this.bundles.insertNextVersion(variantId, components);
  }
}
