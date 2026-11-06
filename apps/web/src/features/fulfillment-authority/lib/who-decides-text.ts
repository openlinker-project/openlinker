/**
 * Who-Decides Text
 *
 * Every operator-facing string for the `/settings/who-decides` page. The words
 * live in the `fulfillment-authority.whoDecides` block of `locales/<lang>/<namespace>.json`
 * (ADR-081, #3875); this module keeps the exported names and shapes the panel,
 * the preset cards and dialog, the question rows and the settings page read,
 * each one reading the active language when it is read.
 *
 * Render order comes from the API's value arrays (`*_ORDER` below), never the
 * key order of the copy, which the locale file sorts.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 3.2 / § 3.3
 */

import { getMessages } from '../../../shared/i18n';
import {
  AuthorityDefaultWhyCodeValues,
  AuthorityPresetIdValues,
  AuthorityPresetUnavailableReasonValues,
  AuthorityQuestionValues,
  type AuthorityPresetId,
  type AuthorityQuestion,
  type AuthorityRowBadge,
} from '../api/who-decides.types';
import { lazyCopy } from './lazy-copy';

const whoDecides = (): ReturnType<typeof getMessages<'fulfillment-authority'>>['whoDecides'] =>
  getMessages('fulfillment-authority').whoDecides;

/** The settings tile that reaches this page. */
export const WHO_DECIDES_TILE_COPY = lazyCopy(() => whoDecides().tile);

export const WHO_DECIDES_PAGE_COPY = lazyCopy(() => whoDecides().page);

export interface PresetCardCopy {
  readonly title: string;
  readonly body: string;
  readonly bestIf: string;
  /** The bolded closing line. Card 1 states that nothing changes; 2 and 3 state what does. */
  readonly changes: string;
  readonly changesLabel: string;
}

/** The three cards; the locale file must hold one per preset (checked by the type). */
export const PRESET_CARD_COPY: Readonly<Record<AuthorityPresetId, PresetCardCopy>> = lazyCopy(
  () => whoDecides().presetCards
);

/** Render order for the cards. */
export const PRESET_CARD_ORDER = AuthorityPresetIdValues;

/**
 * The short labels around the cards and the fallback sentences. Read as
 * properties (`WHO_DECIDES_LABELS.bestIf`) so each read follows the active
 * language - a plain string constant could not.
 */
export const WHO_DECIDES_LABELS: Readonly<{
  bestIf: string;
  current: string;
  unavailable: string;
  unavailableReasonFallback: string;
  whyCodeFallback: string;
}> = lazyCopy(() => whoDecides().presetLabels);

/** Looked up loosely: an unavailable reason this build does not know falls back. */
export const PRESET_UNAVAILABLE_REASON_COPY: Readonly<Record<string, string | undefined>> = lazyCopy(
  () => whoDecides().presetUnavailableReasons
);

export const PRESET_UNAVAILABLE_REASON_ORDER = AuthorityPresetUnavailableReasonValues;

export const PRESET_ACTION_COPY = lazyCopy(() => whoDecides().presetActions);

export const PRESET_CHANGE_MEANING_COPY = lazyCopy(() => whoDecides().presetChangeMeaning);

export const PRESET_CONFIRM_COPY = lazyCopy(() => whoDecides().presetConfirm);

/** One label per question (spec § 3.3); the locale file must hold every question. */
export const QUESTION_LABEL_COPY: Readonly<Record<AuthorityQuestion, string>> = lazyCopy(
  () => whoDecides().questionLabels
);

/** Render order for the seven rows. */
export const QUESTION_ORDER = AuthorityQuestionValues;

export const ANSWER_COPY = lazyCopy(() => whoDecides().answers);

/** Looked up loosely: a why-code this build does not know falls back. */
export const WHY_CODE_COPY: Readonly<Record<string, string | undefined>> = lazyCopy(
  () => whoDecides().whyCodes
);

export const WHY_CODE_ORDER = AuthorityDefaultWhyCodeValues;

export const ROW_BADGE_COPY: Readonly<Record<AuthorityRowBadge, string>> = lazyCopy(
  () => whoDecides().rowBadges
);

export const ROW_DETAIL_COPY = lazyCopy(() => whoDecides().rowDetail);
