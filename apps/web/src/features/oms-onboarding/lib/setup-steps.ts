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
import { INVOICE_TRIGGER_MODEL_VALUES, type InvoiceTriggerModel } from '../../connections';
import { issuedDocumentKinds, type SalesDocumentRow } from '../../sales-documents';
import { withConfigKey } from './config-merge';
import type { OmsOnboardingCopy } from '../hooks/use-oms-onboarding-copy';

export const SetupStepKeys = ['salesDocuments', 'automations', 'whoDecides'] as const;
export type SetupStepKey = (typeof SetupStepKeys)[number];

/**
 * `unknown` is a read that failed or could not be understood. It is never
 * `pending` (that would claim something is missing) and never `done` (that
 * would claim it is fine).
 */
export type SetupStepState = 'done' | 'pending' | 'skipped' | 'unknown';

/**
 * Steps that are only looked at: nothing is set on them, so an installation
 * with none of them is not "partially set up".
 */
export const SETUP_REVIEW_ONLY: readonly SetupStepKey[] = ['automations'];

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
  /** Steps the operator still has to act on, or whose state is not known (review-only steps never are). */
  readonly left: readonly SetupStepKey[];
}

export function summariseSetup(states: Readonly<Record<SetupStepKey, SetupStepState>>): SetupSummary {
  const left = SetupStepKeys.filter(
    (key) => !SETUP_REVIEW_ONLY.includes(key) && (states[key] === 'pending' || states[key] === 'unknown')
  );
  return { complete: left.length === 0, left };
}

/** The title and the one-line state of a step, worded once for every list that shows it. */
export function describeSetupStep(
  key: SetupStepKey,
  state: SetupStepState,
  copy: OmsOnboardingCopy
): { readonly title: string; readonly detail: string } {
  const step = copy.status.steps[key];
  const detail =
    state === 'done'
      ? step.done
      : state === 'skipped'
        ? copy.status.steps.skipped
        : state === 'unknown'
          ? copy.status.steps.unknown
          : step.pending;
  return { title: step.title, detail };
}

// Exhaustive on purpose: a trigger model added to the mirrored union is a compile
// error here, so it cannot silently read as "issued by hand".
const IS_AUTOMATIC_TRIGGER: Record<InvoiceTriggerModel, boolean> = {
  manual: false,
  // #3583: a batch run issues the order without anyone asking.
  batched: true,
  'auto-on-paid': true,
  'auto-on-shipped': true,
};

function isAutomaticTrigger(triggerModel: string): boolean {
  return (
    (INVOICE_TRIGGER_MODEL_VALUES as readonly string[]).includes(triggerModel) &&
    IS_AUTOMATIC_TRIGGER[triggerModel as InvoiceTriggerModel]
  );
}

/**
 * Whether documents get issued without anyone asking: an active connection
 * that issues something, is the one that goes first, and whose trigger is
 * automatic. The trigger defaults to manual and can only be changed on the
 * primary row, so a connection that issues "something" but is not primary, or
 * is primary with the default trigger, leaves every document to be issued by
 * hand. The OMS setup requires the automatic case.
 */
export function hasAutomaticDocumentIssuing(rows: readonly SalesDocumentRow[]): boolean {
  return rows.some(
    (row) =>
      row.status === 'active' &&
      row.documentKind !== null &&
      row.isPrimary &&
      // #3582: per kind. A row issuing both kinds counts when either kind is
      // automatic - receipts at once with invoices by hand is still automatic.
      issuedDocumentKinds(row.documentKind).some((kind) =>
        isAutomaticTrigger(row.triggerModels[kind])
      )
  );
}
