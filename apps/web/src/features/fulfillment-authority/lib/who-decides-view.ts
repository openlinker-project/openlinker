/**
 * Who-Decides Row View Model
 *
 * Pure resolution from the wire row to what the table draws: the badge, the
 * answer text and the why-line. No I/O, no React, no copy of its own — copy
 * comes from `who-decides.copy.ts` and #2357's `attention-reason.copy.ts`.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 3.3
 */

import {
  ATTENTION_REASON_COPY,
  ATTENTION_UNKNOWN_COPY,
} from './attention-reason.copy';
import { isAuthorityAttentionReason } from './attention-reason';
import { ANSWER_COPY, WHY_CODE_COPY, WHY_CODE_FALLBACK } from './who-decides.copy';
import type {
  AuthorityAnswerRow,
  AuthorityAttention,
  AuthorityRowBadge,
  AuthorityState,
} from '../api/who-decides.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

/**
 * The badge a row renders, and its tone.
 *
 * **Resolved from `state` and `source`, never from the question.** Which row is
 * the refunds row and which is the invoices row is a rule that lives in core;
 * testing `question === 'refund-trigger'` here would be a second copy of it.
 *
 * The `state` arm is an EXHAUSTIVE switch with a `never` default rather than a
 * fall-through, and that is load-bearing. An `otherwise -> chosen` arm would be
 * total only because `deriveAuthorityState` currently reaches `'unavailable'`
 * exclusively via `source === 'delegated'` — an invariant living in
 * `libs/core` that `apps/web` can neither import (#591) nor observe. Were core
 * ever to reach it another way, that arm would render `Chosen` on a row where
 * nothing is decided: a positive claim that an operator picked somebody, which
 * is the wave's "never assert what the backend did not say" rule broken in the
 * most expensive direction. `unavailable`-but-not-`delegated` is unreachable
 * today and gets its own neutral rendering rather than inheriting a confident
 * one. Same shape as the `never`-default exhaustiveness #2286 shipped across
 * the `OrderLifecycleEvent` consumers.
 */
export function resolveRowBadge(row: AuthorityAnswerRow): AuthorityRowBadge {
  // A6 — never assignable (ADR-056). Read off `source`, which is how core says so.
  if (row.source === 'fixed-by-design') {
    return 'always';
  }
  // A7 — answered by `sales-documents`, reached by a link.
  if (row.source === 'delegated') {
    return 'elsewhere';
  }

  const state: AuthorityState = row.state;
  switch (state) {
    case 'ambiguous':
      return 'nothing-is-deciding';
    case 'default':
      return row.answer.kind === 'nobody-to-route' ? 'nothing-to-route' : 'default';
    case 'resolved':
      return 'chosen';
    case 'unavailable':
      return 'not-available';
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/**
 * The tone each badge renders in.
 *
 * `nothing-is-deciding` is the only badge that is ever red (§ 3.3). Spec calls
 * `chosen` "accent"; `StatusBadgeTone` has no such member and `info` is already
 * spoken for by `always`, so `success` is the closest available and leaves the
 * two apart.
 */
export function rowBadgeTone(badge: AuthorityRowBadge): StatusBadgeTone {
  switch (badge) {
    case 'nothing-is-deciding':
      return 'error';
    case 'always':
      return 'info';
    case 'chosen':
      return 'success';
    case 'default':
    case 'nothing-to-route':
    case 'elsewhere':
    case 'not-available':
      return 'neutral';
  }
}

/** How a row's answer should be drawn. */
export type AnswerRendering =
  /** A single sentence. */
  | { readonly kind: 'text'; readonly text: string }
  /** One or more systems, joined by a middle dot. Routine, never a problem. */
  | { readonly kind: 'parties'; readonly connectionIds: readonly string[] }
  /** A7 — a link out, mirroring no state of its own. */
  | { readonly kind: 'link' };

/**
 * What this row's answer is.
 *
 * A list of systems is returned as ids rather than text because naming them
 * needs the connections the page separately loaded; the component resolves the
 * names and falls back to the id itself when it cannot, since the id IS what
 * the backend said.
 */
export function resolveAnswer(row: AuthorityAnswerRow): AnswerRendering {
  switch (row.answer.kind) {
    case 'openlinker':
      return { kind: 'text', text: ANSWER_COPY.openlinker };
    case 'manual':
      return { kind: 'text', text: ANSWER_COPY.manual };
    case 'default-today':
      return { kind: 'text', text: ANSWER_COPY.defaultToday };
    case 'nobody-to-route':
      return { kind: 'text', text: ANSWER_COPY.nobodyToRoute };
    case 'cannot-tell':
      return { kind: 'text', text: ANSWER_COPY.cannotTell };
    case 'configured-elsewhere':
      return { kind: 'link' };
    case 'holders':
      return { kind: 'parties', connectionIds: row.answer.parties.map((p) => p.connectionId) };
  }
}

/**
 * The why-line.
 *
 * Spec § 3.3: an ambiguous row's why-line is **replaced** by the matching § 4.2
 * body copy, not qualified by it — the operator reading that row is asking
 * exactly the question § 4.2 answers, and a stale default line under
 * `OpenLinker can't tell` would be a false statement.
 *
 * The § 4.2 body is found by matching the row's own `question` against the
 * attention items the same response already carries, rather than by mirroring
 * core's kind-to-reason map a second time in the browser. Nothing is
 * re-derived, and a reason this build does not recognise (or a missing item)
 * degrades to the shared unknown copy — which is the honest reading of "this
 * build cannot name the cause", not a blank cell.
 */
export function resolveWhyLine(row: AuthorityAnswerRow, attention: AuthorityAttention): string {
  if (row.why.kind === 'ambiguous') {
    const match = attention.counted.find((item) => item.question === row.question);
    if (match && isAuthorityAttentionReason(match.reason)) {
      return ATTENTION_REASON_COPY[match.reason].body;
    }
    return ATTENTION_UNKNOWN_COPY.body;
  }

  return WHY_CODE_COPY[row.why.code] ?? WHY_CODE_FALLBACK;
}

/** The connections an ambiguous row names, so the page can point at them. */
export function resolveCandidateConnectionIds(row: AuthorityAnswerRow): readonly string[] {
  return row.answer.kind === 'cannot-tell' ? row.answer.candidateConnectionIds : [];
}
