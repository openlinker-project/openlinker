/**
 * Amazon feature - public surface
 *
 * The guided connection form (#4186) and the browser copy of Amazon's regions
 * and marketplaces that the plugin's connection-page section reuses.
 *
 * @module features/amazon
 */
export { AmazonMarketplacePicker } from './components/amazon-marketplace-picker';
export { AmazonSetupForm } from './components/amazon-setup-form';
export { SELLER_ID, SQS_QUEUE_URL } from './components/amazon-setup.schema';
export {
  AMAZON_MARKETPLACES,
  AmazonRegionValues,
  findMarketplace,
  isAmazonRegion,
  isSingleMarketplaceRegion,
  marketplacesForRegion,
  type AmazonMarketplace,
  type AmazonRegion,
} from './lib/amazon-marketplaces';
