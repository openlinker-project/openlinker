/**
 * "Who decides what" Copy
 *
 * Every operator-facing string for the `/settings/who-decides` page, in one
 * module — the placement `attention-reason.copy.ts` and `returns-list.copy.ts`
 * established, and the one `scripts/check-ui-vocabulary.mjs` scans most
 * precisely (every string literal in a `*.copy.ts`, versus JSX text plus a
 * scoped attribute allowlist in a `.tsx`).
 *
 * ## Every string literal here is scanned, INCLUDING import paths
 *
 * `check-ui-vocabulary`'s `.copy.ts` extractor takes every literal in the file,
 * unlike its `.tsx` extractor which deliberately skips imports. So a module
 * this file imports from may not carry a banned term in its PATH — which is
 * why the wire contract next door is `api/who-decides.*` rather than
 * `api/authority-status.*`. The names are accurate either way (this is the
 * who-decides page's contract); the constraint just settled which to use.
 *
 * ## These are plain literals, NOT `t(key, fallback)` calls
 *
 * Deliberately, and worth stating because the i18n seam is a no-op today so
 * "doing it properly" looks free. `check-ui-vocabulary` scans string literals
 * TEXTUALLY; routing this file's copy through a translation call would move
 * every sentence out of the gate's reach, on the one page whose whole subject
 * is the vocabulary that gate bans. Every other `*.copy.ts` in the app is
 * plain literals for the same reason.
 *
 * ## This does not restate `attention-reason.copy.ts`
 *
 * #2357 owns the §4.2 inert-state copy, the section furniture and the
 * unknown-reason sentences. They are IMPORTED where this page needs them —
 * an ambiguous row's why-line is *replaced* by the matching §4.2 body (spec
 * §3.3), and that body has exactly one home.
 *
 * ## Sources
 *
 * Card copy, page furniture and why-lines are the Wave-2 product spec's own
 * words (§3.2 / §3.3), reproduced verbatim rather than paraphrased — the spec
 * calls them "exact operator-facing copy" and the mockup renders these strings.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 3.2 / § 3.3
 */

import {
  AuthorityDefaultWhyCodeValues,
  AuthorityPresetIdValues,
  AuthorityPresetUnavailableReasonValues,
  AuthorityQuestionValues,
  type AuthorityDefaultWhyCode,
  type AuthorityPresetId,
  type AuthorityPresetUnavailableReason,
  type AuthorityQuestion,
  type AuthorityRowBadge,
} from '../api/who-decides.types';

/** The settings tile that reaches this page. */
export const WHO_DECIDES_TILE_COPY = {
  eyebrow: 'Decisions',
  title: 'Who decides what',
  description:
    'See which system is in charge of your stock, your orders and your returns — and hand any of it to OpenLinker.',
  linkLabel: 'Open',
  chip: 'Who decides what',
} as const;

/** Page furniture — spec § 3.2's table, verbatim. */
export const WHO_DECIDES_PAGE_COPY = {
  eyebrow: 'Settings',
  title: 'Who decides what',
  lede: 'OpenLinker, your shop, your marketplaces and your warehouse each get to decide different things. This page shows who decides what right now, and lets you hand some of those decisions to OpenLinker — or keep them where they are.',
  backLabel: 'Settings',
  presetsEyebrow: 'Choose an arrangement',
  presetsHeading: 'How should this work?',
  questionsEyebrow: 'Right now',
  questionsHeading: 'Who decides what',
  questionsCounter: '7 decisions',
  /**
   * Always visible, never a tooltip (§ 3.2). The operator-facing rendering of
   * prospective-only revocation, design invariant P7.
   */
  prospectiveOnly:
    'Changing this only affects what happens from now on. Anything already in progress — an order already sent to your shop, a label already bought — keeps its current arrangement until it finishes.',
  loadingTitle: 'Who decides what',
  loading: 'Working out who decides what…',
  errorTitle: 'We could not load this page',
  errorMessage: 'Something went wrong reading your setup. Try again in a moment.',
  retryLabel: 'Try again',
} as const;

export interface PresetCardCopy {
  readonly title: string;
  readonly body: string;
  readonly bestIf: string;
  /** The bolded closing line. Card 1 states that nothing changes; 2 and 3 state what does. */
  readonly changes: string;
  readonly changesLabel: string;
}

/**
 * The three cards, in the order § 3.2 renders them and the order the API's own
 * catalogue declares.
 *
 * `satisfies`, not `:`, so a preset added to the mirrored id list is a compile
 * error here rather than a card that silently never renders.
 */
export const PRESET_CARD_COPY = {
  'leave-as-they-are': {
    title: 'Leave things as they are',
    body: 'Your shop and your marketplaces keep making every decision, exactly as they do now. OpenLinker connects them, publishes your stock and offers, files your invoices, and stays out of the way.',
    bestIf: 'one shop, one warehouse, and nothing about your current setup is annoying you.',
    changesLabel: 'Nothing changes when you pick this.',
    changes: 'It is what OpenLinker already does.',
  },
  'openlinker-decides': {
    title: 'Let OpenLinker decide',
    body: 'OpenLinker becomes the place where decisions get made: it works out how much stock you can safely promise, holds orders that should not go out yet, and decides what happens to goods that come back. Your shop and your carriers still do the physical work.',
    bestIf:
      'you sell the same stock on more than one channel, or you keep finding orders you wish had been stopped before they shipped.',
    changesLabel: 'What this changes:',
    changes:
      'OpenLinker starts subtracting orders it has seen from the stock numbers it publishes, and can hold an order so it never reaches your shop. Your existing stock, order and invoice flows are untouched. Your current setup is kept, so you can switch back.',
  },
  'keep-other-system': {
    title: 'Keep my other system in charge',
    body: 'Your existing warehouse or order system keeps deciding. OpenLinker gives it marketplace connectivity — offers, stock publication, order feed, status relay — and files your Polish invoices and receipts, which it cannot.',
    bestIf:
      'you already run a warehouse or ERP system that you trust and do not want to replace.',
    changesLabel: 'What this changes:',
    changes:
      'OpenLinker stops working out your promisable stock itself and publishes what your system tells it. Refunds and fiscal documents stay with OpenLinker either way — only OpenLinker holds the credentials that can issue them.',
  },
} satisfies Record<AuthorityPresetId, PresetCardCopy>;

/** Render order for the cards — never `Object.keys` of the map above. */
export const PRESET_CARD_ORDER = AuthorityPresetIdValues;

/** Shown on the card that describes the arrangement in force right now. */
export const PRESET_CURRENT_BADGE = 'Current';

/** The badge on a card the operator cannot choose. */
export const PRESET_UNAVAILABLE_BADGE = 'Not available yet';

/**
 * Why a preset cannot be chosen, per code.
 *
 * An unavailable preset renders disabled WITH this reason rather than being
 * hidden: it tells the operator the shape of the choice they will eventually
 * have, which is the same discipline as #2170's disabled tax-id checkbox.
 */
export const PRESET_UNAVAILABLE_REASON_COPY = {
  'needs-a-system-that-can-take-over': 'Needs a system that can take over. Connect one first.',
} satisfies Record<AuthorityPresetUnavailableReason, string>;

export const PRESET_UNAVAILABLE_REASON_FALLBACK =
  'This is not available yet, for a reason this version does not recognise.';

/** Render order for the unavailable-reason vocabulary. */
export const PRESET_UNAVAILABLE_REASON_ORDER = AuthorityPresetUnavailableReasonValues;

/** The apply control and everything it can say afterwards. */
export const PRESET_ACTION_COPY = {
  applyLabel: 'Save this arrangement',
  applyingLabel: 'Saving…',
  readOnly: 'Only an administrator can change who decides what.',
  confirmTitle: 'Change who decides what?',
  confirmLabel: 'Save',
  cancelLabel: 'Cancel',
  successTitle: 'Saved',
  successMessage: 'Who decides what has been updated.',
  /**
   * The apply is several independent saves and cannot be atomic, so a
   * partially-applied result is reported as exactly that. Re-submitting the
   * same choice converges, because every save is repeatable.
   */
  partialTitle: 'Only part of this was saved',
  partialMessage:
    'Some of your connections could not be updated. Nothing is broken — choose the same arrangement again and OpenLinker will finish the rest.',
  /**
   * The refusal is computed over the RESULT, not over what would change, so an
   * arrangement that is already contradictory is refused even by the option
   * that changes nothing.
   */
  ambiguousTitle: 'Nothing was changed',
  ambiguousMessage:
    'This would leave two systems deciding the same thing, so OpenLinker would end up deciding neither. Open the connections named below and leave one of them in charge.',
  /**
   * Unreachable while the frontend and the server agree about the catalogue —
   * the unavailable option is not clickable and the ids are mirrored. Reaching
   * it means they DISAGREE, which is worth saying plainly rather than letting a
   * refused save look like a save that did nothing.
   */
  rejectedTitle: 'OpenLinker did not accept that choice',
  rejectedMessage:
    'Nothing was changed. This build and your server disagree about which arrangements exist — updating OpenLinker should clear it.',
  failedTitle: 'We could not save this',
  failedMessage: 'Nothing was changed. Try again in a moment.',
  /**
   * The save reached the server and the server answered — but this build could
   * not read the answer, so it does not know how much of it was applied.
   *
   * Distinct from every outcome above, and it must NOT collapse into `saved`:
   * `parseAuthorityStatus` returns `null` on any whole-envelope parse failure,
   * and the schema is strict over unions this programme widens wave by wave. On
   * a rolling deploy an apply that wrote 3 of 5 connections and honestly
   * reported the other two would be read as an empty failure list and announced
   * as `Saved`.
   */
  unreadableTitle: 'We could not read the result',
  unreadableMessage:
    'Your arrangement may have been saved in part or in full — OpenLinker could not read the answer to tell you which. Reload this page to see where things stand, then choose the same arrangement again if anything is missing.',
} as const;

/**
 * What a decision's NEW answer means, once it is the answer.
 *
 * One sentence per answer shape — never per arrangement. A sentence exists
 * because an ANSWER exists, so a new arrangement cannot ship a dialog that
 * describes it wrongly, and the confirm dialog is generated from the server's
 * diff rather than restating a card.
 *
 * These say what happens FROM NOW ON, because that is what saving does; the
 * always-present line below says what it does not do to work already running.
 */
export const PRESET_CHANGE_MEANING_COPY = {
  openlinker: 'OpenLinker will decide this from now on.',
  holders: 'The systems named above will decide this from now on.',
  manual: 'Nothing will decide this automatically — you will handle it yourself.',
  defaultToday: 'This goes back to landing wherever it lands today.',
  nobodyToRoute: 'You sell from one place, so there will be nothing to choose between.',
  /**
   * Reachable only in a diff the save is refused for, but written honestly
   * rather than left to a fallback: a sentence this build cannot produce is how
   * an operator ends up reading a confident description of a broken state.
   */
  cannotTell: 'Two of your systems would both be in charge, so OpenLinker would decide neither.',
  configuredElsewhere: 'This stays set up on the Sales documents page.',
} as const;

/** The confirm dialog — everything it can say before an arrangement is saved. */
export const PRESET_CONFIRM_COPY = {
  changesHeading: 'What changes',
  /**
   * Read instead of the arrow glyph, which is `aria-hidden`. Without it the
   * line reads as two answers with no stated relationship between them.
   */
  becomes: 'becomes',
  /**
   * The no-op answer, and it must read differently from a refusal. Here the
   * save is allowed and simply does nothing; a refusal is the block below.
   */
  noChanges: 'Nothing changes when you save this — your setup already works this way.',
  /**
   * Only rendered when the diff shows a claim being switched off. The
   * connection keeps its assignment, so this is a fact about the change rather
   * than reassurance added to soften it.
   */
  assignmentPreserved:
    'Your systems keep their settings, so you can put them back in charge later by switching them on again.',
  loading: 'Working out what this would change…',
  unreadable:
    'We could not work out what this would change, so it cannot be saved yet. Try again in a moment.',
  retryLabel: 'Try again',
  /** The blocked-save state. Nothing is written, and the operator is told which systems clash. */
  blockedTitle: 'This cannot be saved yet',
  blockedIntro:
    'This would leave two systems deciding the same thing, so OpenLinker would decide neither. Open the connections named below and leave one of them in charge.',
} as const;

/** One label per question, in `AuthorityQuestionValues` order (spec § 3.3). */
export const QUESTION_LABEL_COPY = {
  availability: 'How much stock can we promise?',
  sourcing: 'Where does an order ship from?',
  'fulfillment-execution': 'Who picks and ships?',
  'order-lifecycle': 'What state is an order in?',
  'returns-disposition': 'What happens to returned goods?',
  'refund-trigger': 'Who issues refunds?',
  'sales-documents': 'Who issues invoices and receipts?',
} satisfies Record<AuthorityQuestion, string>;

/** Render order for the seven rows — never `Object.keys` of the map above. */
export const QUESTION_ORDER = AuthorityQuestionValues;

/**
 * The answer text for every answer shape that is not a list of systems.
 *
 * A list of systems is assembled from the connections the page already loaded,
 * so it has no entry here.
 */
export const ANSWER_COPY = {
  openlinker: 'OpenLinker',
  manual: 'You handle this by hand',
  defaultToday: 'Wherever the order lands today',
  nobodyToRoute: 'Each shop decides (nothing to route)',
  cannotTell: "OpenLinker can't tell",
  /** A7 renders this as a link out, and mirrors no state of its own. */
  configuredElsewhere: 'Set up under Sales documents',
  /**
   * Only for a connection with no id at all.
   *
   * A connection whose id simply has no NAME renders the id itself instead —
   * the id is what the response actually said, and a placeholder asserts less
   * than the response contains. It also matters where it is worst: two
   * unresolvable candidates on an ambiguous row would otherwise render as two
   * identical links, exactly where the operator has to tell them apart.
   */
  unnamedConnection: 'A connection',
  /** Joins several systems on one row. A list like this is normal, never a problem. */
  separator: ' · ',
} as const;

/**
 * The why-line for each code the server can send.
 *
 * The why-line is the point of the table: an answer with no reason is a
 * configuration dump, while an answer WITH one doubles as the explanation of
 * what the default is.
 */
export const WHY_CODE_COPY = {
  'a1-computed-from-master-minus-buffer':
    'Worked out from your stock master, minus your safety buffer. Nobody else has claimed it.',
  'a1-claimed-by-connection': 'You have put this system in charge of your stock.',
  'a2-single-origin-nothing-to-choose':
    'You sell from one place, so there is nothing to choose between.',
  'a2-claimed-by-connection': 'You have put this system in charge of choosing where orders ship from.',
  'a3-lands-where-it-does-today': 'Whoever the order lands with, as it works today.',
  'a3-claimed-by-connection': 'You have put this system in charge of picking and shipping.',
  'a4-derived-from-observed-facts':
    'OpenLinker works it out from what it can see — the shipment, the invoice, any hold you placed.',
  'a4-claimed-by-connection': 'You have put this system in charge of tracking where an order has got to.',
  'a5-nothing-decides-yet-handled-by-hand': 'Nothing decides yet — you handle returns by hand.',
  'a5-claimed-by-connection': 'You have put this system in charge of deciding what happens to returns.',
  'a6-only-ol-holds-payment-credentials':
    'Only OpenLinker holds the payment credentials, so only OpenLinker can do it. This one cannot be handed over.',
  'a7-configured-under-sales-documents': 'Configured per country under Sales documents.',
} satisfies Record<AuthorityDefaultWhyCode, string>;

/** Render order for the why-code vocabulary. */
export const WHY_CODE_ORDER = AuthorityDefaultWhyCodeValues;

/**
 * What a why-code this build does not recognise renders as.
 *
 * Never a blank line: the table promises a reason on every row, and "we cannot
 * name it" is an honest reason where an empty cell is a broken one.
 */
export const WHY_CODE_FALLBACK =
  'OpenLinker decided this for a reason this version does not recognise.';

/** The closed badge vocabulary of spec § 3.3. */
export const ROW_BADGE_COPY = {
  default: 'Default',
  'nothing-to-route': 'Nothing to route',
  always: 'Always',
  elsewhere: 'Elsewhere',
  chosen: 'Chosen',
  'nothing-is-deciding': 'Nothing is deciding',
  /**
   * Unreachable today. Kept as a real, neutral rendering rather than folded
   * into `chosen`, so a shape this build does not expect can never be reported
   * as a decision somebody made.
   */
  'not-available': 'Not available',
} satisfies Record<AuthorityRowBadge, string>;

/** Per-row extras. */
export const ROW_DETAIL_COPY = {
  /**
   * A6 is rendered locked rather than hidden: it is a statement of physical
   * fact and reads as reassurance, not as a restriction — and hiding it would
   * invite the question as a support ticket instead.
   */
  lockedLabel: 'Cannot be handed over',
  /** A7's link out. */
  elsewhereLinkLabel: 'Set up under Sales documents',
  /**
   * A switched-off connection still carrying a claim never changes the answer,
   * but an operator reading this row needs to know the claim is there.
   */
  inactiveClaimOne: 'A switched-off connection still claims this.',
  inactiveClaimMany: 'Switched-off connections still claim this.',
  questionColumnLabel: 'Decision',
  answerColumnLabel: 'Who decides',
  whyColumnLabel: 'Why',
} as const;
