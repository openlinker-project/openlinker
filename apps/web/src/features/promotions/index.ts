/**
 * Promotions - public surface (#3935)
 *
 * The pages' building blocks: the list table and its peek, the detail composer,
 * the new-promotion flow, the guide and the queries and pure helpers behind
 * them. Promotions replace the gift rules that used to live under Automations;
 * the order side of gifts (the line tag, the add-gift dialog) stays in
 * `features/gifts`.
 */
export { PromotionsTable } from './components/promotions-table';
export { PromotionPeek } from './components/promotion-peek';
export { PromotionComposer } from './components/promotion-composer';
export { PromotionNew } from './components/promotion-new';
export { PromotionsGuide } from './components/promotions-guide';
export {
  usePromotionsQuery,
  usePromotionQuery,
  useSavePromotionMutation,
  useReorderPromotionsMutation,
  useResumePromotionMutation,
  useDeletePromotionMutation,
} from './hooks/use-promotions';
export { promotionsQueryKeys } from './api/promotions.query-keys';
export {
  countPromotions,
  filterPromotions,
  attentionOf,
  tabOf,
  PromotionTabValues,
  PromotionAttentionValues,
  type PromotionTab,
  type PromotionAttention,
} from './lib/promotion-view';
export {
  emptyPromotionForm,
  formToWriteInput,
  promotionToForm,
  type PromotionFormValues,
} from './lib/promotion-form';
export type { Promotion } from './api/promotions.types';
