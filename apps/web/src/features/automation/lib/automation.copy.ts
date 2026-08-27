/**
 * Automation Copy (#2364)
 *
 * Every operator-facing string this feature renders, in one module.
 *
 * Centralised rather than inlined for the reason `returns-list.copy.ts` states:
 * this is what `scripts/check-ui-vocabulary.mjs` scans most precisely — every
 * string literal in a `*.copy.ts`, versus JSX text and a scoped attribute
 * allowlist in a `.tsx`. Plain literals only: routing copy through a
 * `t(key, fallback)` seam would move it out of the gate's reach entirely.
 *
 * **What is NOT here, deliberately: the availability reason strings.** Those
 * belong to the backend and are rendered verbatim (see `action-availability.ts`).
 * They arrive at runtime and are therefore outside this gate's reach — a real
 * limitation, recorded rather than papered over.
 *
 * @module apps/web/src/features/automation/lib
 */
import type {
  AutomationConditionOutcome,
  AutomationNonFiringReason,
  AutomationStepStatus,
} from '../api/automation.types';

export const AUTOMATIONS_PAGE_COPY = {
  eyebrow: 'Operations',
  title: 'Automations',
  description:
    'Rules that act on your orders and returns without you clicking. Each one watches for a single event, checks the conditions you set, and then does what you told it to.',
  runLogAction: 'Run log',
  tableCaption: 'Every event an automation can watch for',
} as const;

/**
 * The eight triggers in operator words.
 *
 * Never the raw dotted identifier: `order.on_hold_for` is a column name, not
 * something a seller says. The identifier still appears on the trigger page as
 * secondary monospace text, so an operator reading the API docs or a support
 * thread can match the two.
 */
export const AUTOMATION_TRIGGER_COPY = {
  'order.hold.placed': {
    label: 'An order is put on hold',
    description: 'Something stopped an order from being sent.',
  },
  'order.hold.released': {
    label: 'An order comes off hold',
    description: 'Whatever was blocking the order has been cleared.',
  },
  'order.on_hold_for': {
    label: 'An order has been stuck for too long',
    description: 'Checked on a timer, not the moment the order stops.',
  },
  'order.dispatch_deadline_near': {
    label: 'A dispatch deadline is close',
    description: 'Checked on a timer, so it can warn you before you are late.',
  },
  'order.packed': {
    label: 'An order is marked packed',
    description: 'Fires the moment someone at the packing bench marks it done.',
  },
  'return.received': {
    label: 'A return arrives',
    description: 'The channel told OpenLinker a return is on its way back.',
  },
  'return.disposed': {
    label: 'A returned item is dealt with',
    description: 'Restocked, scrapped or sent on — whatever you decided.',
  },
  'inventory.reservation_shortfall': {
    label: 'You have sold more than you have',
    description: 'Stock was promised to orders that cannot all be filled.',
  },
} as const;

export const AUTOMATION_FIRING_MODE_COPY = {
  edge: 'When it happens',
  'deadline-sweep': 'On a timer',
} as const;

export const AUTOMATION_INDEX_COPY = {
  triggerHeader: 'When this happens',
  rulesHeader: 'Your rules',
  canDoHeader: 'What it can do now',
  lastFiredHeader: 'Last acted',
  actionsHeader: 'Actions',
  configure: 'Set up',
  ruleCountOne: '1 rule',
  ruleCountNone: 'No rules',
  ruleCountMany: (count: number) => `${count} rules`,
  /**
   * There is no last-acted field to read. `GET /automations/summary` returns
   * a trigger and a count, and nothing else; whether a firing was even recorded
   * is a per-rule fact. Saying so is the only honest cell — a dash would be
   * read as "never", which is a claim about the operator's history that no
   * response here supports.
   */
  /** The mobile card drops the column header, so the badge names its own unit. */
  runnableSteps: (runnable: number, legal: number) => `${runnable} of ${legal} steps work`,
  lastFiredUnknown: 'Not recorded yet',
  lastFiredUnknownHint:
    'OpenLinker does not record what automations did yet, so this cannot say when one last acted. It is not a claim that nothing has.',
  droppedRows: (count: number) =>
    count === 1
      ? '1 event could not be read and is not shown below.'
      : `${count} events could not be read and are not shown below.`,
} as const;

/**
 * The suggestion card, spec §5.1, copy verbatim.
 *
 * Shown only when the operator has no rules at all. Eight triggers reading
 * `No rules` is technically complete and useless as a starting point.
 */
export const AUTOMATION_SUGGESTION_COPY = {
  title: 'You have no automations yet.',
  intro: 'Most sellers start with this one:',
  suggestion:
    'When an order is marked packed → buy the shipping label → tell the marketplace.',
  rationale:
    'One click at the packing bench instead of three, and the marketplace hears about it straight away.',
  primary: 'Set this up',
  secondary: 'Start from scratch',
  /**
   * Said out loud because the card describes buying a label, and buying a
   * label is one of the four things this build cannot do yet. Offering the
   * suggestion without this line would be the silent-decline defect in the one
   * place the product actively recommends an action.
   */
  caveat:
    'Nothing is created by opening this page. You will review the rule and turn it on yourself — and OpenLinker will tell you first if a step cannot run yet.',
} as const;

export const AUTOMATION_AVAILABILITY_COPY = {
  panelTitle: 'What automations can do in this build',
  panelIntro:
    'A rule can be saved with any of these steps, and OpenLinker will accept it. Only the ones marked ready will actually do anything when the rule fires.',
  available: 'Ready',
  partial: 'Works in some cases',
  unavailable: 'Not built yet',
  ruleBlockedTitle: 'This rule cannot act yet',
  ruleBlockedOne: (action: string) => `${action} cannot run in this build.`,
  ruleBlockedMany: (actions: string) => `These steps cannot run in this build: ${actions}.`,
  rulePartialTitle: 'This rule only acts sometimes',
  irreversible: 'Cannot be undone',
} as const;

export const AUTOMATION_RULES_COPY = {
  eyebrow: 'Automations',
  backToIndex: 'All automations',
  nameHeader: 'Rule',
  stepsHeader: 'What it does',
  stateHeader: 'On or off',
  actionsHeader: 'Actions',
  active: 'On',
  inactive: 'Off',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  addRule: 'New rule',
  /** The deactivate promise, said where the operator decides. */
  turnOffHint: 'Turning a rule off keeps everything it has already done.',
  emptyTitle: 'No rules for this event yet',
  emptyMessage: 'Nothing happens automatically when this event occurs.',
  readOnly: 'Your account can look at automations but not change them.',
  moneyAckTitle: 'This rule spends money',
  moneyAckBody:
    'Turning it on lets OpenLinker act on your behalf every time it matches, and those steps cannot be undone.',
  moneyAckConfirm: 'I understand — turn it on',
  cancel: 'Cancel',
  writeFailed: 'The change was not saved',
  neverMatchedUnknown:
    'OpenLinker cannot yet tell you whether this rule has ever matched an order.',
} as const;

export const AUTOMATION_ERROR_COPY = {
  vocabularyTitle: 'Unable to load what automations can do',
  vocabularyMessage:
    'Without this, OpenLinker cannot tell you which steps are legal or which ones work — so it will not guess. Try again in a moment.',
  summaryTitle: 'Unable to load automations',
  rulesTitle: 'Unable to load these rules',
  loadingTitle: 'Loading automations',
  loadingMessage: 'Fetching your rules and what each step can do…',
} as const;

/**
 * The composer (#2365, spec §5.5 + §5.3b).
 *
 * Two sentences here are VERBATIM from the spec and must not be reworded:
 * `nonRetroactivity` and `stopOnFirstFailure`. Both are promises about what the
 * product will and will not do on the operator's behalf.
 */
export const AUTOMATION_COMPOSER_COPY = {
  createTitle: 'New automation',
  nameLabel: 'Name',
  nameHint: 'You will see this on the run log and on the order timeline.',
  whenLabel: 'When this happens',
  onlyIfLabel: 'Only if',
  thenLabel: 'Then do this',
  addCondition: '+ Add condition',
  addAction: '+ Add step',
  removeCondition: 'Remove condition',
  removeAction: 'Remove step',
  conditionsHint:
    'Every condition must be true for the automation to run. Leave this empty to act on every one.',
  /** Spec §5.5, verbatim. */
  nonRetroactivity: 'An automation only acts on things that happen after you save it.',
  /** Spec §5.5 divergence 3, verbatim in substance — stated once, for the rule. */
  stopOnFirstFailure: (max: number) =>
    `Steps run in order, and if one fails the rest are skipped. You can add up to ${max}.`,
  activeLabel: 'Turn this on when I save it',
  activeHint: 'You can save it switched off and turn it on once you are happy with it.',
  effectiveFromLabel: 'Active from',
  effectiveToLabel: 'Active until',
  effectiveToOptional: '(optional)',
  save: 'Save automation',
  saving: 'Saving…',
  cancel: 'Cancel',
  saveFailed: 'The automation was not saved',
  saveFailedGeneric: 'Something went wrong saving this automation. Try again.',
  duplicateRule:
    'You already have an automation that does exactly this over an overlapping period. Both would run, doubling whatever they do — change something about this one, or narrow when it applies.',
  illegalPair: (action: string) =>
    `This event cannot do "${action}". Pick a different step, or a different event to watch for.`,
  triggerConfigLabel: 'How many hours',
  conditionFieldLabel: 'Condition',
  conditionValueLabel: 'Value',
  amountOpLabel: 'Comparison',
  amountLabel: 'Amount',
  currencyLabel: 'Currency',
  currencyHint: 'Only orders in this exact currency can match. Nothing is converted.',
  actionLabel: 'Step',
  /** §5.3b A1 — it takes no parameters, and the copy says why. */
  a1Note:
    'Which document gets issued, and by which provider, is decided by your Sales documents rules. This automation only decides when.',
  /** §5.3b A3 — no selectable status vocabulary. */
  a3Note:
    'OpenLinker relays what it knows. If no label has been bought yet, the marketplace is told the order shipped without a tracking number.',
  /** §5.3b A2 — the standing money line. */
  a2Warning: 'Every time this runs, it buys a label and you are charged for it.',
  carrierLabel: 'Carrier',
  carrierHint: 'Which carrier account to buy from.',
  carrierEmpty: 'No carrier is connected yet, so this step cannot be set up.',
  /**
   * Said plainly because the spec asks for pickers OpenLinker cannot build:
   * there is no service list and no saved package presets anywhere in the
   * product. An empty picker would read as "you have none configured", which is
   * a claim about the operator's setup rather than about OpenLinker's.
   */
  a2NoOptions:
    'Service level and package presets are not available yet, so the carrier default is used and the order’s own weight and size are declared.',
  codLabel: 'Collect the order total from the buyer on delivery',
  recipientLabel: 'Send it to',
  recipientBuyer: 'The buyer',
  recipientAddress: 'A fixed address',
  addressLabel: 'Email address',
  subjectLabel: 'Subject',
  bodyLabel: 'Message',
  mergeFieldsTitle: 'Drop in order details',
  mergeFieldsHint:
    'Click one to insert it. Anything else is sent exactly as you type it — including a field name you mistype, so you can see and fix it.',
  holdReasonLabel: 'Reason',
  holdReasonHint: 'Why it is being held. The operator who finds it sees this.',
  releaseWhichLabel: 'Which hold to lift',
  releaseAnyHold: 'Any hold',
  noteLabel: 'Note',
  noteRequiredHint: 'Required, the same as when you lift a hold by hand.',
  moneyAckLabel:
    'I understand this automation spends money every time it runs, and those steps cannot be undone.',
  readOnly: 'Your account can look at automations but not create them.',
} as const;

/**
 * Condition-field and action labels (#2365).
 *
 * They live HERE, not beside their row components, because
 * `check-ui-vocabulary.mjs` reads every string literal in a `*.copy.ts` but only
 * JSX text and an allow-listed set of JSX attributes in a `.tsx` — an object
 * literal of labels inside a component file is neither, so it would sit outside
 * the gate entirely while every other string in this feature sits inside it.
 */
export const AUTOMATION_CONDITION_FIELD_LABELS: Record<string, string> = {
  sourceConnection: 'The order came from',
  orderCountry: 'The delivery country is',
  orderTotalGross: 'The order total (gross)',
  holdReason: 'The hold reason is',
};

export const AUTOMATION_ACTION_LABELS: Record<string, string> = {
  'issue-sales-document': 'Issue the invoice or receipt',
  'dispatch-shipment': 'Buy the shipping label',
  'relay-status-to-source': 'Tell the marketplace',
  'send-email': 'Send an email',
  'place-hold': 'Put the order on hold',
  'release-hold': 'Lift the hold',
};

/**
 * Why a rule did not fire (#2366).
 *
 * `as const satisfies Record<AutomationNonFiringReason, string>` — compile-time
 * TOTAL, so a fifteenth reason added backend-side and mirrored into the union
 * fails the build here rather than rendering as `undefined`. Read through a
 * `Record<string, string>` lookup with a RAW-CODE fallback so a reason from a
 * newer backend still renders something true (its code) instead of nothing;
 * that is the `describeTrigger` precedent.
 *
 * In the copy module rather than beside the panel, so it stays inside
 * `check-ui-vocabulary` — an object literal in a `.tsx` sits outside the gate
 * entirely, the hole #2365 closed.
 */
export const AUTOMATION_NON_FIRING_REASON_COPY = {
  'trigger-mismatch': 'This rule watches for a different event.',
  'unknown-trigger': 'This rule watches for an event this version does not recognise.',
  'rule-inactive': 'The rule is switched off.',
  'not-yet-effective': 'The rule does not start applying until later.',
  'no-longer-effective': 'The rule stopped applying before this order.',
  'fact-precedes-rule': 'This happened before the rule was saved, and rules are never retroactive.',
  'fact-time-unknown': 'OpenLinker does not know when this happened, so it cannot tell whether the rule already existed.',
  'illegal-trigger-action-pair': 'This rule pairs an event with a step that event can never run.',
  'no-actions': 'The rule has no steps left that this version can run.',
  'trigger-config-invalid': 'The rule is missing the setting its event needs.',
  'condition-not-met': 'A condition was not true for this order.',
  'condition-fact-unknown': 'A condition asked about something OpenLinker does not know for this order.',
  'condition-currency-mismatch': 'The amount is in a different currency from this order, and nothing is converted.',
} as const satisfies Record<AutomationNonFiringReason, string>;

/** Per-condition verdicts. `unknown` and `currency-mismatch` are not `false`. */
export const AUTOMATION_CONDITION_OUTCOME_COPY = {
  true: 'Matched',
  false: 'Not matched',
  unknown: 'Not known for this order',
  'currency-mismatch': 'Different currency',
} as const satisfies Record<AutomationConditionOutcome, string>;

/** How one step of a firing ended. */
export const AUTOMATION_STEP_STATUS_COPY = {
  done: 'Done',
  'nothing-to-do': 'Nothing to do',
  failed: 'Failed',
  skipped: 'Skipped',
} as const satisfies Record<AutomationStepStatus, string>;

export const AUTOMATION_DRY_RUN_COPY = {
  title: 'Test on a recent order',
  intro:
    'Pick an order from the last 30 days and see what this rule would have done. Nothing is sent, bought or changed.',
  orderLabel: 'Order',
  orderPlaceholder: 'Select an order…',
  run: 'Run the test',
  running: 'Testing…',
  noOrders: 'No orders in the last 30 days, so there is nothing to test against yet.',
  ordersFailed: 'Unable to load recent orders.',
  failedTitle: 'The test did not run',
  /**
   * Said where the branch is written: a draft is re-validated exactly as a save
   * would be, so an incomplete rule answers with the save's own refusals. An
   * empty verdict list here would claim the rule matches nothing, when the truth
   * is that it was never evaluated.
   */
  failedHint: 'Nothing was evaluated, so this says nothing about whether the rule would match.',
  wouldFire: 'This rule would have run',
  wouldNotFire: 'This rule would not have run',
  /**
   * `wouldFire` AND the waiver together. The dry run waives the retroactivity
   * floor that the real path enforces, so "would have run" is FALSE for an
   * order older than the rule — the headline has to say so, not leave it to a
   * note underneath.
   */
  wouldMatchNotFire: 'This rule matches, but would not have run',
  matchedButBlocked:
    'It matched this order, but another rule already does something that cannot be done twice.',
  blockedByPrefix: 'Held back by',
  blockedActionsPrefix: 'because both would',
  retroactivityWaived:
    'It matches, but this order is older than the rule — so it would not actually have run. Only things that happen after you save it are acted on.',
  conditionsTitle: 'Conditions',
  noConditions: 'This rule has no conditions, so it applies to every one of these events.',
  stepsTitle: 'Steps it would run',
  factsTitle: 'What OpenLinker knew about this order',
  factSourceLabel: 'Came from',
  factCountryLabel: 'Delivery country',
  factTotalLabel: 'Order total',
  factWhenLabel: 'Happened',
  staleResult:
    'You changed the rule after this test, so the result below describes the previous version.',
  factUnknown: 'Not known',
  otherRulesTitle: 'Other rules on this event',
  noOtherRules: 'No other rules watch this event.',
  gateLocked: 'Test this rule before saving it — it can spend money, and OpenLinker cannot undo that.',
  gateStale:
    'You changed the rule after testing it. Test it again so what you save is what you checked.',
  gatePassed: 'Tested.',
} as const;

export const AUTOMATION_RUN_LOG_COPY = {
  title: 'What this rule has done',
  show: 'Show history',
  hide: 'Hide history',
  loading: 'Loading history…',
  failed: 'Unable to load this rule’s history.',
  empty: 'This rule has not run yet.',
  outcomeLabel: 'Result',
  whenLabel: 'When',
  orderLabel: 'Order',
  stepsLabel: 'Steps',
  jobLink: 'Job',
  blockedByPrefix: 'Held back by',
  unreadableSteps: (count: number) =>
    count === 1
      ? '1 step could not be read and is not shown.'
      : `${count} steps could not be read and are not shown.`,
} as const;

export const AUTOMATION_RUN_OUTCOME_COPY: Record<string, string> = {
  done: 'Done',
  failed: 'Failed',
  'nothing-to-do': 'Nothing to do',
  blocked: 'Held back',
};

export const AUTOMATION_ACTIVITY_COPY = {
  eyebrow: 'Automations',
  title: 'Run log',
  description: 'What your automations have actually done.',
  notYetTitle: 'There is no combined run log yet',
  notYetMessage:
    'OpenLinker records what an automation did against the rule that did it, so history is shown on each rule rather than in one list. A single feed across every rule is still being built.',
  backToIndex: 'Back to automations',
} as const;
