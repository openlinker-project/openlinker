/**
 * Fulfillment authority — public surface
 *
 * Public barrel for the fulfillment-authority feature. Cross-feature callers
 * (#2356 renders these badges on orders, products, returns and connections)
 * import only from here — never from `lib/`.
 *
 * #2357 shipped the copy + mirror half; #2354 added the "Who decides what"
 * page, its transport and its row view model; #2355 added the generated
 * preset-change confirmation and its preview transport.
 */
export type {
  AuthorityAttentionBadge,
  AuthorityAttentionMirrorEntry,
  AuthorityAttentionReason,
} from './lib/attention-reason';
export {
  ATTENTION_REASON_MIRROR,
  AuthorityAttentionBadgeValues,
  AuthorityAttentionCountedReasonValues,
  AuthorityAttentionReasonValues,
  attentionBadgeTone,
  isAuthorityAttentionReason,
} from './lib/attention-reason';

export type { AttentionReasonCopy, AttentionTitleParams } from './lib/attention-reason.copy';
export {
  ATTENTION_BADGE_COPY,
  ATTENTION_REASON_COPY,
  ATTENTION_SECTION_COPY,
  ATTENTION_UNKNOWN_COPY,
  attentionTitle,
  listAttentionReasonCopy,
} from './lib/attention-reason.copy';

export { WhoDecidesPanel } from './components/who-decides-panel';
export { WhoDecidesTile } from './components/who-decides-tile';
export { WhoDecidesPresetCards } from './components/who-decides-preset-cards';
export {
  WhoDecidesPresetConfirm,
  isPresetConfirmBlocked,
} from './components/who-decides-preset-confirm';
export { WhoDecidesQuestionRow } from './components/who-decides-question-row';

export { useWhoDecidesStatusQuery } from './hooks/use-who-decides-status-query';
export { useApplyPresetMutation } from './hooks/use-apply-preset-mutation';
export { usePresetPreviewQuery } from './hooks/use-preset-preview-query';

export { createFulfillmentAuthorityApi } from './api/who-decides.api';
export type { FulfillmentAuthorityApi } from './api/who-decides.api';
export { whoDecidesQueryKeys } from './api/who-decides.query-keys';
export { parseAuthorityPresetPreview, parseAuthorityStatus } from './api/who-decides.schema';

export type {
  AuthorityAnswer,
  AuthorityAnswerRow,
  AuthorityAttention,
  AuthorityAttentionItem,
  AuthorityPreset,
  AuthorityPresetApplyReport,
  AuthorityPresetChange,
  AuthorityPresetId,
  AuthorityPresetPreview,
  AuthorityQuestion,
  AuthorityRowBadge,
  AuthoritySource,
  AuthorityState,
  AuthorityStatus,
} from './api/who-decides.types';
export {
  AuthorityPresetIdValues,
  AuthorityQuestionValues,
  AuthorityRowBadgeValues,
  AuthoritySourceValues,
  AuthorityStateValues,
  isAuthorityPresetId,
  isAuthorityQuestion,
} from './api/who-decides.types';

export type { AuthorityKind } from './lib/authority-kind';
export { AuthorityKindValues, isAuthorityKind } from './lib/authority-kind';

export { buildPresetDiff } from './lib/preset-diff';
export type { PresetDiffLine, PresetDiffView } from './lib/preset-diff';

export {
  resolveAnswer,
  resolveCandidateConnectionIds,
  resolveRowBadge,
  resolveWhyLine,
  rowBadgeTone,
} from './lib/who-decides-view';
export type { AnswerRendering } from './lib/who-decides-view';

export {
  PRESET_ACTION_COPY,
  PRESET_CARD_COPY,
  PRESET_CHANGE_MEANING_COPY,
  PRESET_CONFIRM_COPY,
  PRESET_CARD_ORDER,
  QUESTION_LABEL_COPY,
  QUESTION_ORDER,
  ROW_BADGE_COPY,
  WHO_DECIDES_PAGE_COPY,
  WHO_DECIDES_TILE_COPY,
} from './lib/who-decides.copy';
