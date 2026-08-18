/**
 * Platform-label resolver (#1784 follow-up, #2088)
 *
 * The single path from a `platformType` to the human-readable label the plugin
 * registry declares for it, falling back to the raw `platformType` when no
 * plugin is registered.
 *
 * This is the ONLY place the `platforms.find(...)?.displayName ?? platformType`
 * lookup may live. Before #2088 it was re-inlined at 13 call sites and shadowed
 * by a hardcoded four-entry map on the Orders list, so `erli` and `woocommerce`
 * rendered raw and lowercase there while rendering correctly two pages over —
 * a registry that half the app disagreed with (#1996).
 *
 * Deliberately still in `features/mappings` rather than `shared/plugins`, where
 * frame 13 of the #1996 mockup proposed moving it: PR #2032 established the
 * barrel path for its second cross-feature consumer, and re-litigating it would
 * churn ~14 import lines for no behavioural gain. Recorded so nobody reading the
 * mockup "fixes" it back.
 *
 * @module apps/web/src/features/mappings/lib
 */

interface PlatformLike {
  platformType: string;
  displayName: string;
}

interface ConnectionLike {
  platformType: string;
}

/**
 * The registry lookup with NO fallback — `undefined` when no plugin declares
 * this `platformType`.
 *
 * Exists because two call sites fall back to the operator-authored
 * `connection.name` rather than the raw type (the coverage pills on the products
 * list and the product row detail, where a name disambiguates two shops on one
 * platform far better than a lowercase slug would). They need the lookup without
 * the policy, and routing them through `resolvePlatformLabel` would have swapped
 * their fallback silently. Callers that want the raw-type fallback use
 * `resolvePlatformLabel` instead — do not re-inline the `find` for either.
 *
 * @param platform a bare `platformType`, or anything carrying one (a
 *   `Connection`, an offer mapping, a publish destination). Both shapes exist at
 *   the call sites in roughly equal number, so accepting both is what keeps the
 *   sites from wrapping a string in an object literal just to satisfy a
 *   signature.
 */
export function findPlatformDisplayName(
  platforms: readonly PlatformLike[],
  platform: string | ConnectionLike,
): string | undefined {
  const platformType = typeof platform === 'string' ? platform : platform.platformType;
  return platforms.find((p) => p.platformType === platformType)?.displayName;
}

/**
 * The lookup plus the app-wide fallback: the raw `platformType`.
 *
 * **Why raw and not title-cased.** The dashboard used to capitalise its own
 * fallback (`woocommerce` → `Woocommerce`), and #2088 deleted that rather than
 * promoting it, deliberately. Title-casing a slug manufactures a plausible but
 * WRONG brand name for exactly the platforms whose names are not one word —
 * `Woocommerce`, `Bigcommerce`, `Prestashop` — so it reads as a product name
 * while being incorrect. A raw slug reads as an unresolved identifier, which is
 * what it is: the fallback only fires when no plugin declares the platform,
 * i.e. a misconfiguration, and an ops surface should show that rather than
 * disguise it. #2088's AC states it as "renders the raw string rather than
 * blank".
 *
 * The cost, accepted: `amazon` and `shopify` had hand-written Title Case in the
 * Orders list's deleted `CHANNEL_LABELS` map and now render raw. Neither has a
 * backend adapter, so no shipped connection can reach it. A site that has a
 * `Connection` in hand and wants something friendlier than a slug should use
 * `findPlatformDisplayName(...) ?? connection.name` instead — the operator's own
 * name for the destination beats both a slug and a mis-cased brand.
 */
export function resolvePlatformLabel(
  platforms: readonly PlatformLike[],
  platform: string | ConnectionLike,
): string {
  const platformType = typeof platform === 'string' ? platform : platform.platformType;
  return findPlatformDisplayName(platforms, platformType) ?? platformType;
}
