/**
 * PrestaShop Order-Feed Capability Cache
 *
 * Some PrestaShop installs refuse `date_upd` as a sort/filter field on the
 * `orders` webservice resource - PrestaShop's own error code 38, "Unable to
 * filter by this field.", naming a shop-specific allowed-field list that
 * excludes it (#2877, verified live on 9.0.2). The field genuinely is not on
 * that shop's own filterable-field list; nothing in OpenLinker can make it
 * sortable, so the answer never changes for that shop within this process.
 *
 * Once a connection's shop has said so, every later poll re-attempting the
 * `date_upd` sort would rediscover the identical refusal at the cost of a
 * failed request (plus the webservice client's own 5xx retry ladder) before
 * falling back - so the answer is remembered here, per connection id, for the
 * life of this process.
 *
 * Held on the adapter factory (a process-singleton) rather than on the
 * adapter itself, mirroring `PrestashopOrderCurrencyResolver` and the other
 * per-connection caches next to it in `PrestashopAdapterFactory`: the factory
 * builds a fresh `PrestashopOrderSourceAdapter` per capability resolution, so
 * a cache living on the adapter would never hit.
 *
 * Deliberately in-memory rather than persisted to `connection_cursors`: a
 * worker restart re-discovers the refusal once more, at the cost of one
 * failed request plus its retries - the same cost every other
 * process-singleton cache in this factory already accepts for its own
 * per-connection answer (shop identity, default currency, tax rate, ...).
 *
 * The fact is about the SHOP, not the connection ROW, so it is dropped -
 * `clearCache` - whenever `PrestashopAdapterFactory.dropCachesOnShopIdentityChange`
 * detects the same connection id now points at a different shop, exactly like
 * every sibling cache next to it there.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
export class PrestashopOrderFeedCapabilityCache {
  private readonly dateUpdSortUnsupported = new Set<string>();

  /**
   * True once this connection's shop has already refused `date_upd` as a
   * sort/filter field on `orders` (code 38).
   */
  isDateUpdSortKnownUnsupported(connectionId: string): boolean {
    return this.dateUpdSortUnsupported.has(connectionId);
  }

  /**
   * Record that this connection's shop refuses `date_upd` as a sort/filter
   * field on `orders`. One-way for the life of a given shop identity - see
   * `clearCache` for the one case that resets it sooner than a process
   * restart.
   */
  markDateUpdSortUnsupported(connectionId: string): void {
    this.dateUpdSortUnsupported.add(connectionId);
  }

  /**
   * Drop the remembered answer for this connection id.
   *
   * The refusal is a fact about the SHOP, not the connection row - so when a
   * connection is repointed at a different shop (`dropCachesOnShopIdentityChange`
   * on `PrestashopAdapterFactory`), the old shop's answer must not keep
   * governing the new one. Without this, a connection repointed from an
   * affected shop to one that accepts `date_upd` would stay silently stuck in
   * the narrowed id-only mode for the rest of the process's life, since
   * nothing else ever re-attempts the `date_upd` sort once it has failed
   * once.
   */
  clearCache(connectionId: string): void {
    this.dateUpdSortUnsupported.delete(connectionId);
  }
}
