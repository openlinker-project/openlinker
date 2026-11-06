/**
 * Shopify - public surface
 *
 * Public barrel for the Shopify feature (#3974): the API namespace the plugin
 * registers, the setup form the setup page renders, and the callback hook the
 * callback page uses.
 */
export type { ShopifyApi, ShopifyCallbackResponse } from './api/shopify.api';
export { createShopifyApi } from './api/shopify.api';
export { ShopifySetupForm } from './components/shopify-setup-form';
export { useHandleShopifyCallback, type ShopifyCallbackState } from './hooks/use-handle-shopify-callback';
