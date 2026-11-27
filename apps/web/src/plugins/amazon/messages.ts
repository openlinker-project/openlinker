/**
 * Amazon plugin messages
 *
 * The plugin reads the core `amazon` namespace (`locales/{en,pl}/amazon.json`),
 * which the setup form in `features/amazon` shares; a plugin-owned namespace
 * of the same name would collide with it (the Shopify precedent).
 *
 * @module plugins/amazon
 */
import { getMessages, useMessages } from '../../shared/i18n';

type AmazonMessages = ReturnType<typeof getMessages<'amazon'>>;

export function useAmazonMessages(): AmazonMessages {
  return useMessages('amazon');
}

export function getAmazonMessages(): AmazonMessages {
  return getMessages('amazon');
}
