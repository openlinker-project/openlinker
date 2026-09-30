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

export const TOTAL_STEPS = 7;

/**
 * Turning packing on is the LAST step: everything it depends on, and the rest
 * of the OMS with it, is set up before anything changes in how orders are
 * handled, which is what the page's own description promises.
 */
export const TURN_ON_STEP = 7;

/** The wizard step each decision after "See what changes" lives at (1-based). */
export const SETUP_STEP_NUMBERS = { salesDocuments: 4, automations: 5, whoDecides: 6 } as const;

/** The capability the packing connection needs for work to reach the bench (#3476). */
export const PACKING_EXECUTOR_CAPABILITY = 'FulfillmentExecutor';

export type OnboardingView = 'wizard' | 'waiting' | 'first' | 'status';

export type OnboardingDataState =
  | 'step-1-product-master'
  | 'step-1-no-product-master'
  | 'step-1-two-product-masters'
  | 'step-1-stock-syncing'
  | 'step-1-stock-complete'
  | 'step-2-packers-empty'
  | 'step-2-packer-added'
  | 'step-3-what-changes'
  | 'step-4-sales-documents'
  | 'step-5-automations'
  | 'step-6-who-decides'
  | 'step-7-turn-on'
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
      return input.packerCount > 0 ? 'step-2-packer-added' : 'step-2-packers-empty';
    case 3:
      return 'step-3-what-changes';
    case 4:
      return 'step-4-sales-documents';
    case 5:
      return 'step-5-automations';
    case 6:
      return 'step-6-who-decides';
    default:
      return 'step-7-turn-on';
  }
}

/**
 * Where a fresh page load starts. Packing that was ever turned on lands on the
 * status page (on or paused); otherwise the wizard opens at step 1 until it is
 * done, then at step 2 — packers are optional and step 3's acknowledgement is
 * deliberately re-asked after a reload, so neither is "done" by server state.
 */
export function initialPosition(
  live: boolean,
  paused: boolean,
  step1Done: boolean
): { view: OnboardingView; step: number } {
  if (live || paused) return { view: 'status', step: TURN_ON_STEP };
  return { view: 'wizard', step: step1Done ? 2 : 1 };
}
