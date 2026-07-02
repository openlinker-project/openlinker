/**
 * Erli Plugin Constants
 *
 * Single source of truth for the Erli adapter key and shared patterns, used
 * by the manifest (`erli-plugin.ts`) and the per-connection factory / adapters
 * without a circular import (a leaf module both sides depend on).
 *
 * @module libs/integrations/erli/src
 */
export const ERLI_ADAPTER_KEY = 'erli.shopapi.v1';

/**
 * Seller-keyed product-id allowlist pattern. The id is interpolated into the
 * request path, so it MUST exclude `/`, `?`, `#`, and `..` (path-traversal /
 * injection) regardless of any future #992 charset change; `encodeURIComponent`
 * is the backstop. Today the id is the OL internal variant id. If #992 switches
 * the seller-key format, this constant AND all call sites that use it must change
 * in lockstep (a mismatch fails closed: updates throw, never send).
 */
export const ERLI_PRODUCT_ID_PATTERN = /^ol_variant_[a-f0-9]{32}$/;
