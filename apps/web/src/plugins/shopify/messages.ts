/**
 * Shopify plugin messages
 *
 * The plugin reads the core `shopify` namespace (`locales/{en,pl}/shopify.json`),
 * which the setup form in `features/shopify` shares. A second, plugin-owned
 * `shopify` namespace would collide with it, so the edit section's copy lives
 * there too.
 *
 * @module plugins/shopify
 */
import { getMessages, useMessages } from '../../shared/i18n';

type ShopifyMessages = ReturnType<typeof getMessages<'shopify'>>;

export function useShopifyMessages(): ShopifyMessages {
  return useMessages('shopify');
}

export function getShopifyMessages(): ShopifyMessages {
  return getMessages('shopify');
}
