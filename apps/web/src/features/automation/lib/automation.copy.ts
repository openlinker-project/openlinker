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

export const AUTOMATION_ACTIVITY_COPY = {
  eyebrow: 'Automations',
  title: 'Run log',
  description: 'What your automations have actually done.',
  notYetTitle: 'There is no combined run log yet',
  notYetMessage:
    'OpenLinker records what an automation did against the rule that did it, so history is shown on each rule rather than in one list. A single feed across every rule is still being built.',
  backToIndex: 'Back to automations',
} as const;
