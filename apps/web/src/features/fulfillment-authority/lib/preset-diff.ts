/**
 * Preset Diff View Model
 *
 * Turns the server's preset preview into the sentences the confirm dialog
 * renders. Pure: no I/O, no React, no copy of its own.
 *
 * ## Generated, never static — which is the whole point of #2355
 *
 * There is no per-preset paragraph anywhere in this feature. A line exists
 * because the SERVER said that row's answer changes, and its meaning is keyed
 * on the resulting ANSWER, so a new arrangement or a new decision row cannot
 * ship a dialog that says something untrue about it.
 *
 * ## The answers are rendered by the table's own resolver
 *
 * `before` / `after` are full rows, so both go through `resolveAnswer` rather
 * than a second renderer — the dialog and the table cannot describe one answer
 * differently.
 *
 * ## `preservesAssignment` is derived from the DIFF, not from the preset id
 *
 * A change moving away from a list of systems is a claim being switched off.
 * The arrangement that does that keeps the assignment on the connection (it
 * writes `enabled: false` and nothing else), so the dialog says the choice is
 * reversible — and it says it because the diff has that shape, not because a
 * particular card was picked.
 *
 * Note the discriminant, which is easy to misread: the view model renames the
 * party LIST to `parties` (`holder` is a banned operator-facing term) while
 * `kind` stays `'holders'` in both the wire shape and the view shape.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 3.4 (S1-2 / S1-3)
 */

import { resolveAnswer, type AnswerRendering } from './who-decides-view';
import { PRESET_CHANGE_MEANING_COPY, QUESTION_LABEL_COPY } from './who-decides.copy';
import type { AuthorityAnswerKind, AuthorityPresetChange, AuthorityQuestion } from '../api/who-decides.types';

/** One generated sentence: what this decision was, what it becomes, what that means. */
export interface PresetDiffLine {
  readonly question: AuthorityQuestion;
  readonly label: string;
  readonly before: AnswerRendering;
  readonly after: AnswerRendering;
  /** What the NEW answer means operationally. Keyed on the answer, never on the preset. */
  readonly meaning: string;
}

export interface PresetDiffView {
  readonly lines: readonly PresetDiffLine[];
  /**
   * True when any change switches a claim OFF rather than moving it elsewhere.
   *
   * The connection keeps the assignment, so the operator can switch back — the
   * dialog must say so, or the change reads as a deletion of configuration they
   * cannot reconstruct.
   */
  readonly preservesAssignment: boolean;
}

/**
 * What an answer means, once it is the answer.
 *
 * Exhaustive with a `never` default rather than a fall-through: an `otherwise`
 * arm would be total only because of a rule living in `libs/core`, which
 * `apps/web` can neither import (#591) nor observe, and it would render a
 * confident sentence about an answer this build does not understand.
 */
function meaningOf(kind: AuthorityAnswerKind): string {
  switch (kind) {
    case 'openlinker':
      return PRESET_CHANGE_MEANING_COPY.openlinker;
    case 'holders':
      return PRESET_CHANGE_MEANING_COPY.holders;
    case 'manual':
      return PRESET_CHANGE_MEANING_COPY.manual;
    case 'default-today':
      return PRESET_CHANGE_MEANING_COPY.defaultToday;
    case 'nobody-to-route':
      return PRESET_CHANGE_MEANING_COPY.nobodyToRoute;
    case 'cannot-tell':
      return PRESET_CHANGE_MEANING_COPY.cannotTell;
    case 'configured-elsewhere':
      return PRESET_CHANGE_MEANING_COPY.configuredElsewhere;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Build the dialog's sentence set from the server's diff. */
export function buildPresetDiff(changes: readonly AuthorityPresetChange[]): PresetDiffView {
  const lines = changes.map((change) => ({
    question: change.question,
    label: QUESTION_LABEL_COPY[change.question],
    before: resolveAnswer(change.before),
    after: resolveAnswer(change.after),
    meaning: meaningOf(change.after.answer.kind),
  }));

  return {
    lines,
    preservesAssignment: changes.some(
      (change) => change.before.answer.kind === 'holders' && change.after.answer.kind !== 'holders',
    ),
  };
}
