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

/**
 * Which variant external id, if any, a towar symbol is already mapped under -
 * WITHOUT minting one.
 *
 * The lookup-only twin of {@link resolveTowarVariantId}, and the distinction is
 * the whole reason it exists separately. That one is called by the ProductMaster
 * sync, which is entitled to mint: it is reading the catalogue and recording
 * what it found. This one is called while ingesting an ORDER, where minting
 * would create a variant id for a towar OpenLinker has never synced and point
 * the order line at a product that does not exist - the `getOrCreateInternalId`
 * trap the returns attribution avoided for the same reason.
 *
 * Checks both shapes in the same order and for the same reason the minting twin
 * does: an install that predates the canonical key still carries bare symbols.
 *
 * Returns the EXTERNAL id (not the internal one), because its caller builds an
 * `OrderItemProductRef`, which names an external id by contract.
 */
export async function findTowarVariantExternalId(
  identifierMapping: IdentifierMappingPort,
  connectionId: string,
  symbol: string
): Promise<string | null> {
  const legacy = await identifierMapping.getInternalId(
    CORE_ENTITY_TYPE.ProductVariant,
    symbol,
    connectionId
  );
  if (legacy) {
    return symbol;
  }
  const canonical = canonicalVariantExternalId(symbol);
  const mapped = await identifierMapping.getInternalId(
    CORE_ENTITY_TYPE.ProductVariant,
    canonical,
    connectionId
  );
  return mapped ? canonical : null;
}

/**
 * The towar symbol behind a variant's external id, whichever shape it carries.
 *
 * The inverse of {@link canonicalVariantExternalId}, and tolerant of the bare
 * legacy key for the same reason the resolver is. This is what lets a model
 * member's variant name a real `tw_Symbol` on a document or an order line -
 * the PRODUCT mapping cannot, because a model product's external id is
 * `model:{id}`, which is not a towar at all.
 */
export function towarSymbolFromVariantExternalId(externalId: string): string {
  const suffix = '::variant';
  return externalId.endsWith(suffix) ? externalId.slice(0, -suffix.length) : externalId;
}
