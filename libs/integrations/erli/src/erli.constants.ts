/**
 * Erli Plugin Constants
 *
 * Single source of truth for the Erli adapter key, shared by the manifest
 * (`erli-plugin.ts`) and the per-connection factory / adapters without a
 * circular import (a leaf module both sides depend on).
 *
 * @module libs/integrations/erli/src
 */
export const ERLI_ADAPTER_KEY = 'erli.shopapi.v1';
