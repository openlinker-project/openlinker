/**
 * After-issue attention types (DEF-26)
 *
 * The copy the after-issue attention resolver reads and the sentence pair it
 * returns, kept apart from the resolver in `after-issue-attention.ts`.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

/** The `orders.afterIssueAttention` copy, in the active language. */
export type AfterIssueAttentionCopyTree = ResolvedCopy<Messages['orders']>['afterIssueAttention'];

/** The short label and the longer explanation for one after-issue reason. */
export interface AfterIssueAttentionCopy {
  readonly short: string;
  readonly detail: string;
}
