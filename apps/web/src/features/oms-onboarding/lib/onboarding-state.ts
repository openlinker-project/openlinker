/**
 * Packing onboarding state (#3457)
 *
 * One pure derivation from server facts to the wizard's position and to the
 * mockup's `data-state` vocabulary. Nothing about the operator's progress is
 * kept in local storage: reloading the page lands where the server says the
 * setup is, because the setup IS the server's configuration.
 *
 * The vocabulary is the mockup's, verbatim
 * (`docs/plans/mockups/oms-onboarding-wizard.html`, the comment block above
 * `stateName()`), because the E2E spec (#3458) addresses states by name.
 *
 * ## "Is packing on" is the server's answer
 *
 * The who-decides `sourcing` row is the backend's own reading of every
 * connection's claim, so it is authoritative; re-implementing that coercer in
 * the browser would be a second answer that can disagree. The raw config is
 * read only when the row is unavailable, and only to render.
 *
 * @module features/oms-onboarding/lib
 */
import type { Connection } from '../../connections';
import type { AuthorityAnswerRow } from '../../fulfillment-authority';
import type { InventoryLocation } from '../../inventory';
import { readSourcingClaim, readStockLocationOverride } from './config-merge';
import { MAX_PRODUCT_MASTERS } from './product-masters';

export const TOTAL_STEPS = 8;

/**
 * The wizard's steps, in order (1-based). Sales documents come right after the
 * product master: which document an order gets is decided by what the shop
 * sells, not by who packs it. Shipping follows the packers because a label is
 * bought when a packer accepts a parcel (#3958). "Turn it on" is LAST, so
 * nothing changes in how orders are handled until everything before it is set
 * up, which is what the page's own description promises.
 */
export const WIZARD_STEPS = {
  productMaster: 1,
  salesDocuments: 2,
  packers: 3,
  shipping: 4,
  whatChanges: 5,
  automations: 6,
  whoDecides: 7,
  turnOn: 8,
} as const;

export type WizardStepKey = keyof typeof WIZARD_STEPS;

/**
 * The `?step=` values the wizard accepts, a fixed list so the parameter can
 * only ever select a step and is never read as a path or passed anywhere else.
 */
export const WIZARD_STEP_KEYS: readonly WizardStepKey[] = [
  'productMaster',
  'salesDocuments',
  'packers',
  'shipping',
  'whatChanges',
  'automations',
  'whoDecides',
  'turnOn',
];

/** The URL search parameter holding the current wizard step. */
export const WIZARD_STEP_PARAM = 'step';

/** The step number a `?step=` value names, or `null` for an absent or unknown value. */
export function wizardStepFromKey(value: string | null): number | null {
  if (value === null) return null;
  const key = WIZARD_STEP_KEYS.find((candidate) => candidate === value);
  return key === undefined ? null : WIZARD_STEPS[key];
}

/** The `?step=` value for a step number. */
export function wizardStepKey(step: number): WizardStepKey {
  return WIZARD_STEP_KEYS.find((key) => WIZARD_STEPS[key] === step) ?? 'productMaster';
}

export const TURN_ON_STEP = WIZARD_STEPS.turnOn;

/** The wizard step each setup decision lives at. */
export const SETUP_STEP_NUMBERS = {
  salesDocuments: WIZARD_STEPS.salesDocuments,
  automations: WIZARD_STEPS.automations,
  whoDecides: WIZARD_STEPS.whoDecides,
} as const;

/** The capability the packing connection needs for work to reach the bench (#3476). */
export const PACKING_EXECUTOR_CAPABILITY = 'FulfillmentExecutor';

export type OnboardingView = 'wizard' | 'waiting' | 'first' | 'status';

export type OnboardingDataState =
  | 'step-1-product-master'
  | 'step-1-no-product-master'
  | 'step-1-two-product-masters'
  | 'step-1-stock-syncing'
  | 'step-1-stock-complete'
  | 'step-2-sales-documents'
  | 'step-3-packers-empty'
  | 'step-3-packer-added'
  | 'step-4-shipping'
  | 'step-5-what-changes'
  | 'step-6-automations'
  | 'step-7-who-decides'
  | 'step-8-turn-on'
  | 'waiting-first-order'
  | 'first-order-arrived'
  | 'status-on'
  | 'status-off';

/**
 * Display metadata only — never branched on. The mockup names three platforms;
 * anything else reads `other` rather than being forced into one of them.
 */
export type OnboardingDataSource = 'prestashop' | 'woocommerce' | 'subiekt' | 'none' | 'two' | 'other';

const NAMED_SOURCES: ReadonlySet<string> = new Set(['prestashop', 'woocommerce', 'subiekt']);

export function resolveDataSource(masters: readonly Connection[]): OnboardingDataSource {
  if (masters.length === 0) return 'none';
  if (masters.length > 1) return 'two';
  const key = masters[0].platformType;
  return NAMED_SOURCES.has(key) ? (key as OnboardingDataSource) : 'other';
}

/**
 * Who decides where orders are packed, as far as this wizard is concerned.
 *
 * - `ours`    — the packing connection does.
 * - `other`   — another connection does, or two claim it. Turning ours on
 *               would leave the row ambiguous, so step 4 refuses.
 * - `none`    — nobody does.
 * - `unknown` — the row could not be read.
 */
export type SourcingStanding = 'ours' | 'other' | 'none' | 'unknown';

export function readSourcingStanding(
  row: AuthorityAnswerRow | undefined,
  packingConnectionId: string | null
): SourcingStanding {
  if (row === undefined) return 'unknown';
  const { answer } = row;
  if (answer.kind === 'holders') {
    const parties = answer.parties.map((party) => party.connectionId);
    if (packingConnectionId !== null && parties.includes(packingConnectionId)) {
      return parties.length === 1 ? 'ours' : 'other';
    }
    return parties.length === 0 ? 'none' : 'other';
  }
  if (answer.kind === 'cannot-tell') return 'other';
  return 'none';
}

/** Packing is on: the server says ours decides, or (row unreadable) the claim reads on. */
export function isPackingLive(
  standing: SourcingStanding,
  packingConnection: Connection | null
): boolean {
  if (standing === 'ours') return true;
  if (standing !== 'unknown') return false;
  return packingConnection !== null && readSourcingClaim(packingConnection.config) === 'on';
}

/** Packing was turned on once and then stopped: the claim key is present and off. */
export function isPackingPaused(packingConnection: Connection | null, live: boolean): boolean {
  if (live || packingConnection === null) return false;
  return readSourcingClaim(packingConnection.config) === 'off';
}

export interface Step1Facts {
  readonly masters: readonly Connection[];
  readonly packingConnection: Connection | null;
  readonly mainLocation: InventoryLocation | null;
}

/**
 * Step 1 is done when every write the Confirm makes is in place: the packing
 * connection exists, is active and can take work, the warehouse is active, and
 * every product master's stock points at it.
 */
export function isStep1Done({ masters, packingConnection, mainLocation }: Step1Facts): boolean {
  if (masters.length === 0 || masters.length > MAX_PRODUCT_MASTERS) return false;
  if (packingConnection === null || packingConnection.status !== 'active') return false;
  if (!packingConnection.enabledCapabilities.includes(PACKING_EXECUTOR_CAPABILITY)) return false;
  if (mainLocation === null || mainLocation.status !== 'active') return false;
  return masters.every((master) => readStockLocationOverride(master.config) === mainLocation.id);
}

/**
 * Product masters whose stock already points at a DIFFERENT location. v1 is
 * one warehouse, so Confirm must not silently overwrite an operator's own
 * choice — the step blocks and names the connection instead.
 */
export function findConflictingMasters(
  masters: readonly Connection[],
  mainLocation: InventoryLocation | null
): Connection[] {
  return masters.filter((master) => {
    const override = readStockLocationOverride(master.config);
    return override !== null && (mainLocation === null || override !== mainLocation.id);
  });
}

export interface DataStateInput {
  readonly view: OnboardingView;
  readonly live: boolean;
  readonly step: number;
  readonly masterCount: number;
  readonly step1Done: boolean;
  readonly stockComplete: boolean;
  readonly packerCount: number;
}

export function deriveDataState(input: DataStateInput): OnboardingDataState {
  if (input.view === 'waiting') return 'waiting-first-order';
  if (input.view === 'first') return 'first-order-arrived';
  if (input.view === 'status') return input.live ? 'status-on' : 'status-off';
  switch (input.step) {
    case 1:
      if (input.masterCount === 0) return 'step-1-no-product-master';
      if (input.step1Done) return input.stockComplete ? 'step-1-stock-complete' : 'step-1-stock-syncing';
      return input.masterCount > 1 ? 'step-1-two-product-masters' : 'step-1-product-master';
    case 2:
      return 'step-2-sales-documents';
    case 3:
      return input.packerCount > 0 ? 'step-3-packer-added' : 'step-3-packers-empty';
    case 4:
      return 'step-4-shipping';
    case 5:
      return 'step-5-what-changes';
    case 6:
      return 'step-6-automations';
    case 7:
      return 'step-7-who-decides';
    default:
      return 'step-8-turn-on';
  }
}

/**
 * Where a fresh page load starts. A step named in the URL wins, so an operator
 * who left the wizard (to connect a carrier, say) comes back to the step they
 * left. Without one, packing that was ever turned on lands on the status page
 * (on or paused); otherwise the wizard opens at step 1 until it is done, then
 * at step 2 (sales documents). The later steps are not "done" by server state
 * alone: packers are optional and "See what changes" is deliberately re-asked
 * after a reload.
 *
 * A requested step past step 1 is honoured only once step 1 is done, because
 * every later step assumes the packing connection exists. "Turn it on" is not
 * reopened for packing that is already on or paused: the status page is where
 * that control lives.
 */
export function initialPosition(
  live: boolean,
  paused: boolean,
  step1Done: boolean,
  requestedStep: number | null = null
): { view: OnboardingView; step: number } {
  if (requestedStep !== null && (step1Done || requestedStep === WIZARD_STEPS.productMaster)) {
    const turnOnReopened = requestedStep === TURN_ON_STEP && (live || paused);
    if (!turnOnReopened) return { view: 'wizard', step: requestedStep };
  }
  if (live || paused) return { view: 'status', step: TURN_ON_STEP };
  return { view: 'wizard', step: step1Done ? WIZARD_STEPS.salesDocuments : WIZARD_STEPS.productMaster };
}
