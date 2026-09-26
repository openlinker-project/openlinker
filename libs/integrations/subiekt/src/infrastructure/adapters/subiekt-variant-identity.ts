/**
 * Subiekt variant identity
 *
 * THE resolution of "which internal variant id does this towar symbol have",
 * and the only place either master is allowed to answer it.
 *
 * ## Why this is one function and not two call sites
 *
 * There are two writers. `SubiektProductMasterAdapter` mints a variant when it
 * reads a product; `SubiektInventoryMasterAdapter` mints one when it reads a
 * model's stock. They used to agree by accident - both minted the bare
 * `{symbol}` - and a fix applied to only the first one (#3365, commit
 * `f05822752`) made them disagree for all NEW data while leaving every
 * existing install untouched, so nothing on a seeded stand could notice.
 *
 * The consequence is not cosmetic. `inventory_items.productVariantId` carries
 * a real foreign key to `product_variants`, so on a FRESH install the product
 * sweep writes the variant row under one key and the inventory sweep mints a
 * second, row-less id under the other - and every inventory write for every
 * model product fails the constraint, on every tick. If the sweeps land the
 * other way round, the inventory sweep creates the bare mapping first and the
 * legacy branch below permanently adopts it, silently reverting the fix.
 *
 * That is `docs/lessons.md` § "Two paths can agree about a VALUE and disagree
 * about IDENTITY" happening to the very change that lesson was written about.
 * One function with two callers is what makes the repeat impossible rather
 * than merely unlikely.
 *
 * ## The rule
 *
 * The canonical key is `{symbol}::variant`. The bare `{symbol}` is consulted
 * FIRST and reused when it exists, because that is what both paths minted
 * before: an install already carrying bare mappings keeps them rather than
 * being re-identified on the next sweep, which would orphan its offers exactly
 * once, on upgrade, for a consistency gain nothing reads.
 *
 * `SubiektInventoryMasterAdapter.resolveAdjustmentSymbol` strips `::variant`
 * before asking the bridge, so both shapes resolve to the same towar - which
 * is precisely why the two writers could disagree about identity for so long
 * while agreeing about quantity.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 */
import { CORE_ENTITY_TYPE, type IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

/** The canonical variant external id for a towar symbol. */
export function canonicalVariantExternalId(symbol: string): string {
  return `${symbol}::variant`;
}

/**
 * Resolve (or mint) the internal variant id for one towar symbol.
 *
 * Legacy-first, canonical-second — see the module docblock for why that
 * ordering is what makes this safe to deploy rather than a one-time repeat of
 * the bug it fixes.
 */
export async function resolveTowarVariantId(
  identifierMapping: IdentifierMappingPort,
  connectionId: string,
  symbol: string
): Promise<string> {
  const legacy = await identifierMapping.getInternalId(
    CORE_ENTITY_TYPE.ProductVariant,
    symbol,
    connectionId
  );
  if (legacy) {
    return legacy;
  }
  return identifierMapping.getOrCreateInternalId(
    CORE_ENTITY_TYPE.ProductVariant,
    canonicalVariantExternalId(symbol),
    connectionId
  );
}
