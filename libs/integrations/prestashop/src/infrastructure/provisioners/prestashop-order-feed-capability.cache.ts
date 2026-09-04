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
   * field on `orders`. One-way for the life of this process - see the class
   * header for why a shop that later starts allowing it again is only
   * rediscovered on the next process restart.
   */
  markDateUpdSortUnsupported(connectionId: string): void {
    this.dateUpdSortUnsupported.add(connectionId);
  }
}
