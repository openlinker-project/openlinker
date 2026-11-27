/**
 * Order line expansion resolution (#3607, #3624, #3945)
 *
 * The one place that decides WHICH bundle definitions apply to an order's lines
 * and what physical lines they expand to. Ingestion freezes the result onto the
 * order record; the gift rules read the same answer BEFORE that freeze (gifts are
 * evaluated first), so "skip if the product is already in the order" and the
 * stock that is later reserved are computed from one function and cannot
 * disagree. A re-ingestion passes the already frozen definitions and re-reads
 * nothing.
 *
 * @module libs/core/src/orders/application/services
 */
import {
  buildPackLineDefinitions,
  expandBundleLines,
  type BundleDefinition,
  type ExpandableLine,
  type IBundleDefinitionService,
  type PhysicalLine,
} from '@openlinker/core/products';

type LineWithPack = ExpandableLine & { packQuantity?: number };

/** The definitions (bundles plus confirmed multipacks) that apply to these lines now. */
export async function resolveLineExpansionDefinitions(
  items: readonly LineWithPack[],
  bundles: Pick<IBundleDefinitionService, 'findCurrentByVariantIds' | 'findConfirmedMultipacks'>
): Promise<BundleDefinition[]> {
  const variantIds = [
    ...new Set(items.map((i) => i.variantId).filter((id): id is string => Boolean(id))),
  ];
  const definitions = await bundles.findCurrentByVariantIds(variantIds);
  // A multipack line (pack quantity N) expands to N units of its variant when
  // confirmed, or to N x the bundle's components.
  const packPairs = items
    .filter((i) => i.variantId !== undefined && (i.packQuantity ?? 1) > 1)
    .map((i) => ({ variantId: i.variantId as string, packQuantity: i.packQuantity as number }));
  const confirmed = packPairs.length === 0 ? [] : await bundles.findConfirmedMultipacks(packPairs);
  return [...definitions, ...buildPackLineDefinitions(items, definitions, confirmed)];
}

/**
 * The physical lines of an order: from the frozen definitions when the record
 * has them, otherwise from the live ones (what the freeze is about to persist).
 */
export async function previewPhysicalLines<T extends LineWithPack>(
  items: readonly T[],
  frozenDefinitions: readonly BundleDefinition[] | null | undefined,
  bundles: Pick<IBundleDefinitionService, 'findCurrentByVariantIds' | 'findConfirmedMultipacks'>
): Promise<PhysicalLine<T>[]> {
  const definitions = frozenDefinitions ?? (await resolveLineExpansionDefinitions(items, bundles));
  return expandBundleLines(items, definitions);
}
