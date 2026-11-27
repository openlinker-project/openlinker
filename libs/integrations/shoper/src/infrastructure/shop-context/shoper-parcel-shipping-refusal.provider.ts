/**
 * Shoper Parcel Shipping Refusal Provider
 *
 * Remembers which of a shop's shipping methods Shoper refused a parcel for, so
 * the fulfillment writeback (#3643) pays for each refusal once rather than on
 * every dispatch.
 *
 * The writeback first tries the parcel under the order's own shipping method
 * (so the parcel carries the carrier the buyer chose) and falls back only when
 * Shoper answers that the method does not resolve for a parcel. Shoper's API
 * refuses carrier-integrated methods (InPost, DPD, ...) this way, and a method
 * does not change kind between dispatches, so without memory every InPost order
 * would cost one rejected `POST /parcels` before its fallback - against a
 * request budget of about 10/s per shop that every integration on it shares.
 *
 * Two levels, the shape `ShoperOrderReferenceProvider` uses: a per-instance set,
 * and the host cache when wired, because `getCapabilityAdapter` builds a fresh
 * adapter bag per call and a per-instance memory alone would forget between
 * dispatches. Keys are connection- and host-scoped by the factory's prefix.
 * Everything here is best-effort: a cache that cannot be read or written only
 * means one more try of the order's own method, never a wrong parcel.
 *
 * @module libs/integrations/shoper/src/infrastructure/shop-context
 */
import type { CachePort } from '@openlinker/shared';

/**
 * A day. Long enough that a shop's InPost orders pay for the refusal roughly
 * once a day; short enough that an operator who switches a method's engine in
 * the shop sees the change without restarting anything.
 */
export const PARCEL_SHIPPING_REFUSAL_TTL_SEC = 24 * 60 * 60;

export interface ShoperParcelShippingRefusalCacheOptions {
  readonly cache?: CachePort | undefined;
  /** Connection-scoped key prefix; without it (or without a cache) memory lasts one instance. */
  readonly keyPrefix?: string;
}

/** What is stored per refused method. A shape, not a bare `true`, so a stray value under the key reads as a miss. */
interface RefusalEntry {
  readonly refused: true;
}

function isRefusalEntry(value: unknown): value is RefusalEntry {
  return typeof value === 'object' && value !== null && (value as { refused?: unknown }).refused === true;
}

export class ShoperParcelShippingRefusalProvider {
  private readonly refused = new Set<number>();

  constructor(private readonly cacheOptions: ShoperParcelShippingRefusalCacheOptions = {}) {}

  /** Whether Shoper is known to refuse a parcel under this shipping method. */
  async isRefused(shippingId: number): Promise<boolean> {
    if (this.refused.has(shippingId)) {
      return true;
    }
    const target = this.cacheTarget(shippingId);
    if (target === null) {
      return false;
    }
    try {
      const hit = isRefusalEntry(await target.cache.get<unknown>(target.key));
      if (hit) {
        this.refused.add(shippingId);
      }
      return hit;
    } catch {
      // Best-effort: an unreadable cache just means the method is tried again.
      return false;
    }
  }

  /** Record that Shoper refused a parcel under this shipping method. */
  async remember(shippingId: number): Promise<void> {
    this.refused.add(shippingId);
    const target = this.cacheTarget(shippingId);
    if (target === null) {
      return;
    }
    try {
      const entry: RefusalEntry = { refused: true };
      await target.cache.set(target.key, entry, PARCEL_SHIPPING_REFUSAL_TTL_SEC);
    } catch {
      // Best-effort: the next dispatch simply tries the method once more.
    }
  }

  private cacheTarget(shippingId: number): { readonly cache: CachePort; readonly key: string } | null {
    const { cache, keyPrefix } = this.cacheOptions;
    if (cache === undefined || keyPrefix === undefined) {
      return null;
    }
    return { cache, key: `${keyPrefix}:${shippingId}` };
  }
}
