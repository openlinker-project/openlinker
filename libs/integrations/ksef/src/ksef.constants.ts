/**
 * KSeF Plugin Constants
 *
 * Single source of truth for the KSeF adapter key + brand label, shared by the
 * manifest (`ksef-plugin.ts`) and the per-connection factory / adapters without
 * a circular import (a leaf module both sides depend on).
 *
 * `adapterKey` follows the in-tree `{provider}.{api-type}.{major-version}`
 * convention (Allegro `allegro.publicapi.v1`, Erli `erli.shopapi.v1`). The
 * `v2` segment pins the KSeF Public API major version: a future major API
 * version ships as a new plugin keyed `ksef.publicapi.v3` (a new connection
 * with its own credentials), while minor/patch KSeF changes stay inside this
 * adapter without a key change.
 *
 * @module libs/integrations/ksef/src
 */
export const KSEF_ADAPTER_KEY = 'ksef.publicapi.v2';

/** Human-readable plugin identifier surfaced in dispatch + validation errors. */
export const KSEF_BRAND = 'KSeF';
