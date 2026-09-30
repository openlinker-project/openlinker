/**
 * The setup steps after packing works (#3457)
 *
 * Packing is the first thing the OMS takes over. Three more decisions belong
 * to it and are made elsewhere: which document a sale gets, what happens by
 * itself once an order is packed, and who decides what. This file is the pure
 * half of showing them: what each step's state is and how the page summarises
 * them. No I/O, so the rule is testable without a page.
 *
 * @module features/oms-onboarding/lib
 */
import { withConfigKey } from './config-merge';

export const SetupStepKeys = ['salesDocuments', 'automations', 'whoDecides'] as const;
export type SetupStepKey = (typeof SetupStepKeys)[number];

/**
 * `unknown` is a read that failed or could not be understood. It is never
 * `pending` (that would claim something is missing) and never `done` (that
 * would claim it is fine).
 */
export type SetupStepState = 'done' | 'pending' | 'skipped' | 'unknown';

/** Where the operator takes each step. */
export const SETUP_STEP_PATHS: Readonly<Record<SetupStepKey, string>> = {
  salesDocuments: '/settings/sales-documents',
  automations: '/automations',
  whoDecides: '/settings/who-decides',
};

/** Key on the OMS connection's config recording the steps declared not needed. */
export const SETUP_SKIPPED_KEY = 'setupSkipped';

function isSetupStepKey(value: unknown): value is SetupStepKey {
  return typeof value === 'string' && (SetupStepKeys as readonly string[]).includes(value);
}

/** The steps declared not needed; unreadable or unknown entries are ignored. */
export function readSetupSkipped(config: Record<string, unknown> | null | undefined): SetupStepKey[] {
  const raw = config?.[SETUP_SKIPPED_KEY];
  return Array.isArray(raw) ? raw.filter(isSetupStepKey) : [];
}

/** A new config with `key` added to or removed from the skipped steps. */
export function withSetupSkipped(
  config: Record<string, unknown> | null | undefined,
  key: SetupStepKey,
  skipped: boolean
): Record<string, unknown> {
  const rest = readSetupSkipped(config).filter((existing) => existing !== key);
  return withConfigKey(config, SETUP_SKIPPED_KEY, skipped ? [...rest, key] : rest);
}

/**
 * `done` is `null` when the answer could not be read. A skipped step stays
 * skipped even then: it says nothing is expected of the operator.
 */
export function deriveSetupStepState(done: boolean | null, skipped: boolean): SetupStepState {
  if (skipped) return 'skipped';
  if (done === null) return 'unknown';
  return done ? 'done' : 'pending';
}

export interface SetupSummary {
  /** Every step is done or declared not needed. */
  readonly complete: boolean;
  /** Steps the operator still has to act on, or whose state is not known. */
  readonly left: readonly SetupStepKey[];
}

export function summariseSetup(states: Readonly<Record<SetupStepKey, SetupStepState>>): SetupSummary {
  const left = SetupStepKeys.filter((key) => states[key] === 'pending' || states[key] === 'unknown');
  return { complete: left.length === 0, left };
}
