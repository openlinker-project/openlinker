/**
 * Authority Status Schema
 *
 * Zod parse of `GET /fulfillment-authority/status` and the apply response
 * (#2353) into the typed view model the who-decides page renders.
 *
 * Three decisions this file owns.
 *
 * **`.nullish()`, never `.optional()` (#939).** OpenLinker serialises an absent
 * optional field as JSON `null`, and a bare `.optional()` rejects `null` — the
 * failure that once blanked a whole address section from one empty field. Every
 * nullable field here is `.nullish()` so both shapes survive; `applied` and
 * `unavailableReason` are the two that bite on this payload.
 *
 * **The parse is whole-envelope, not per-row.** The returns list drops a bad
 * row and reports the count, which is right for a paged list of independent
 * records. This payload is one indivisible answer: spec § 2.3 promises SEVEN
 * rows on any install, so five rows and two drops would be a page quietly
 * asserting that two decisions do not exist. An unreadable envelope is
 * therefore reported as unreadable and the page renders an error, which is the
 * only honest rendering of "this build cannot read your setup".
 *
 * **A whole-envelope parse means every closed union here is a page-wide single
 * point of failure — so a code the operator does not act on structurally is not
 * one.** These unions are hand-copies of core's (the browser bundle cannot
 * depend on `@openlinker/core`, #591), and only `AuthorityKindValues` carries a
 * build-enforced mirror. During any rolling deploy a newer API can hand this
 * bundle a code it has never heard of. Where that code merely selects a
 * SENTENCE — `why.code`, a preset's `unavailableReason` — it is parsed as
 * `z.string()` and the copy module's existing fallback names it honestly on
 * that one line. Where it selects STRUCTURE the page reasons about —
 * `question`, `state`, `source`, the answer discriminant — it stays a closed
 * enum, because rendering a row whose answer this build cannot interpret would
 * be worse than declining to draw the table. Extending a mirror script instead
 * would keep the two in step and still hard-fail the page during the skew
 * window, which is exactly the window the `unreadable` apply outcome exists
 * because we accept as real.
 *
 * @module apps/web/src/features/fulfillment-authority/api
 */
import { z } from 'zod/v4';
import {
  AuthorityAmbiguityReasonValues,
  AuthorityPresetIdValues,
  AuthorityQuestionValues,
  AuthoritySourceValues,
  AuthorityStateValues,
  type AuthorityAnswerRow,
  type AuthorityAttentionItem,
  type AuthorityPresetPreview,
  type AuthorityStatus,
} from './who-decides.types';

const answerPartySchema = z.object({
  connectionId: z.string(),
  scope: z.object({ kind: z.string() }).nullish(),
});

/**
 * The answer union, discriminated on `kind`.
 *
 * Core names the party list `holders`; the view model renames it `parties`
 * because `holder` is a banned operator-facing term (`check-ui-vocabulary`) and
 * keeping the wire spelling would invite it into a component's JSX.
 */
const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('openlinker') }),
  z.object({ kind: z.literal('holders'), holders: z.array(answerPartySchema) }),
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('default-today') }),
  z.object({ kind: z.literal('nobody-to-route') }),
  z.object({
    kind: z.literal('cannot-tell'),
    reason: z.enum(AuthorityAmbiguityReasonValues),
    candidateConnectionIds: z.array(z.string()),
  }),
  z.object({ kind: z.literal('configured-elsewhere'), surface: z.string() }),
]);

const whySchema = z.discriminatedUnion('kind', [
  // `code` is `z.string()`, not `z.enum(...)` — see the module docblock's third
  // note. It is what makes `WHY_CODE_FALLBACK` reachable.
  z.object({ kind: z.literal('default'), code: z.string() }),
  z.object({ kind: z.literal('ambiguous'), reason: z.enum(AuthorityAmbiguityReasonValues) }),
]);

const rowSchema = z.object({
  question: z.enum(AuthorityQuestionValues),
  state: z.enum(AuthorityStateValues),
  source: z.enum(AuthoritySourceValues),
  answer: answerSchema,
  why: whySchema,
  inactiveClaimantConnectionIds: z.array(z.string()).nullish(),
});

/**
 * An attention item's `reason` / `badge` / `origin` stay plain strings.
 *
 * This page reads only `question` and `connectionIds` from them (to replace an
 * ambiguous row's why-line), and #2357's `isAuthorityAttentionReason` is the
 * guard that narrows a reason where one is actually rendered. Enumerating the
 * union a second time here would be a second place for it to drift.
 */
const attentionItemSchema = z.object({
  reason: z.string(),
  badge: z.string(),
  surfaces: z.array(z.string()).nullish(),
  origin: z.string(),
  question: z.enum(AuthorityQuestionValues).nullish(),
  connectionIds: z.array(z.string()).nullish(),
});

const attentionSchema = z.object({
  counted: z.array(attentionItemSchema),
  routine: z.array(attentionItemSchema),
  affectedOrderCount: z.number(),
});

const presetSchema = z.object({
  id: z.enum(AuthorityPresetIdValues),
  available: z.boolean(),
  unavailableReason: z.string().nullish(),
});

const appliedSchema = z.object({
  updatedConnectionIds: z.array(z.string()),
  failedConnectionIds: z.array(z.string()),
});

const statusSchema = z.object({
  rows: z.array(rowSchema),
  attention: attentionSchema,
  presets: z.array(presetSchema),
  applied: appliedSchema.nullish(),
});

/**
 * One wire row to one view row.
 *
 * Extracted so the preset preview maps its `before` / `after` through the very
 * same function the table's rows go through — two mappers would let the dialog
 * and the table describe one answer differently.
 *
 * Note the rename is of the FIELD, not the discriminant: core calls the party
 * list `holders` and the view model calls it `parties` (because `holder` is a
 * banned operator-facing term), while `kind` stays `'holders'` in both.
 */
function toRow(row: z.infer<typeof rowSchema>): AuthorityAnswerRow {
  return {
    question: row.question,
    state: row.state,
    source: row.source,
    answer:
      row.answer.kind === 'holders'
        ? {
            kind: 'holders' as const,
            parties: row.answer.holders.map((party) => ({
              connectionId: party.connectionId,
              scopeKind: party.scope?.kind ?? 'global',
            })),
          }
        : row.answer,
    why: row.why,
    inactiveClaimantConnectionIds: row.inactiveClaimantConnectionIds ?? [],
  };
}

function toAttentionItem(
  item: z.infer<typeof attentionItemSchema>,
): AuthorityAttentionItem {
  return {
    ...item,
    surfaces: item.surfaces ?? [],
    question: item.question ?? null,
    connectionIds: item.connectionIds ?? [],
  };
}

function toStatus(parsed: z.infer<typeof statusSchema>): AuthorityStatus {
  return {
    rows: parsed.rows.map(toRow),
    attention: {
      counted: parsed.attention.counted.map(toAttentionItem),
      routine: parsed.attention.routine.map(toAttentionItem),
      affectedOrderCount: parsed.attention.affectedOrderCount,
    },
    presets: parsed.presets.map((preset) => ({
      id: preset.id,
      available: preset.available,
      unavailableReason: preset.unavailableReason ?? null,
    })),
    applied: parsed.applied
      ? {
          updatedConnectionIds: parsed.applied.updatedConnectionIds,
          failedConnectionIds: parsed.applied.failedConnectionIds,
        }
      : null,
  };
}

const previewSchema = z.object({
  presetId: z.enum(AuthorityPresetIdValues),
  changes: z.array(
    z.object({ question: z.enum(AuthorityQuestionValues), before: rowSchema, after: rowSchema }),
  ),
  resultingAmbiguities: z.array(attentionItemSchema),
  blocked: z.boolean(),
});

/**
 * Parse a status (or apply) response.
 *
 * Returns `null` when the envelope cannot be read — the caller renders the
 * error state rather than an empty table, because an empty table on this page
 * would be a positive claim that the operator has no decisions to see.
 */
export function parseAuthorityStatus(payload: unknown): AuthorityStatus | null {
  const parsed = statusSchema.safeParse(payload);
  return parsed.success ? toStatus(parsed.data) : null;
}

/**
 * Parse a preset-preview response.
 *
 * Whole-envelope, like the status parse and for the same reason: a half-read
 * diff would let the dialog make a PARTIAL claim about what saving does, which
 * is worse than declining to claim anything. `null` therefore means "this build
 * cannot read the answer", and the dialog says so and refuses the save rather
 * than letting an unexplained write go out.
 */
export function parseAuthorityPresetPreview(payload: unknown): AuthorityPresetPreview | null {
  const parsed = previewSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return {
    presetId: parsed.data.presetId,
    changes: parsed.data.changes.map((change) => ({
      question: change.question,
      before: toRow(change.before),
      after: toRow(change.after),
    })),
    resultingAmbiguities: parsed.data.resultingAmbiguities.map(toAttentionItem),
    blocked: parsed.data.blocked,
  };
}
