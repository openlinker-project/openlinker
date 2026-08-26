/**
 * Fulfillment authority — public surface
 *
 * Public barrel for the fulfillment-authority feature. Cross-feature callers
 * (#2356 renders these badges on orders, products, returns and connections)
 * import only from here — never from `lib/`.
 *
 * #2357 ships the copy + mirror half. #2354 / #2355 add the "Who decides what"
 * page, its preset flow and their own exports.
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
