/**
 * Gifts - public surface (#3940)
 *
 * Gift promotions (the list and the composer), the gift line tag and the "Add
 * gift" dialog on an order, and the notices that say why an order has no gift it
 * should have.
 */
export { GiftPromotionsList } from './components/gift-promotions-list';
export { GiftRuleComposer } from './components/gift-rule-composer';
export { GiftRuleTemplateCards } from './components/gift-rule-template-cards';
export { GiftLineTag } from './components/gift-line-tag';
export { AddGiftDialog } from './components/add-gift-dialog';
export { OrderAddGiftAction } from './components/order-add-gift-action';
export { OrderGiftAttention } from './components/order-gift-attention';
export {
  useGiftAttentionQuery,
  useSkipGiftAttentionMutation,
  useGiftRuleQuery,
  useGiftRulesQuery,
  useReorderGiftRulesMutation,
  useDeleteGiftRuleMutation,
  useResumeGiftRuleMutation,
  useSaveGiftRuleMutation,
} from './hooks/use-gift-rules';
export { useVariantNames } from './hooks/use-variant-names';
export { giftsQueryKeys } from './api/gifts.query-keys';
export {
  GiftRuleKindValues,
  emptyGiftRuleForm,
  formToWriteInput,
  ruleToForm,
  type GiftRuleFormValues,
  type GiftRuleKind,
} from './lib/gift-rule-form';
export { isGiftSource, isAddedByOpenLinker, type GiftSource, type LineGift } from './lib/gift-line';
export type { GiftRule } from './api/gifts.types';
