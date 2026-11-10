/**
 * Gifts - public surface (#3940)
 *
 * The order side of gifts: the gift line tag, the "Add gift" dialog on an order
 * and the notices that say why an order has no gift it should have. The
 * promotions that add gifts by rule live in `features/promotions`.
 */
export { GiftsGuide } from './components/gifts-guide';
export { GiftLineTag } from './components/gift-line-tag';
export { AddGiftDialog } from './components/add-gift-dialog';
export { OrderAddGiftAction } from './components/order-add-gift-action';
export { OrderGiftAttention } from './components/order-gift-attention';
export { useGiftAttentionQuery, useSkipGiftAttentionMutation } from './hooks/use-gifts';
export { useVariantNames } from './hooks/use-variant-names';
export { useVariantSummaries } from './hooks/use-variant-summaries';
export { channelMarker, coversNativeChannel, orderSourceChannels } from './lib/gift-channels';
export { giftCostText, readGiftCost } from './lib/gift-cost';
export { giftsQueryKeys } from './api/gifts.query-keys';
export { isGiftSource, isAddedByOpenLinker, type GiftSource, type LineGift } from './lib/gift-line';
