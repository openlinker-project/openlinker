/**
 * Sync Pacing Changes
 *
 * Builds the list the confirmation modal is made of: only the values that
 * actually changed, each with its own one-line consequence.
 *
 * That "only" is the whole point. A modal that says the same thing every time
 * is clicked through by reflex and protects nothing, so this returns an empty
 * array when nothing moved and the page opens no modal at all.
 *
 * Pure, and tested on its own - the sentences an operator reads before a save
 * are as much the feature as the numbers behind them.
 *
 * @module apps/web/src/features/settings/lib
 */
import { getMessages, interpolate } from '../../../shared/i18n';
import type {
  OperationalSettingField,
  OperationalSettingKey,
} from '../api/operational-settings.types';
import { isAboveRecommended, type ValueLimits } from './resolve-value-limits';
import { describeCadence } from './deletion-audit-cadence';
import {
  formatDays,
  formatSeconds,
  projectSyncPacing,
  readCadenceIntervalMinutes,
  type SyncPacingProjection,
} from './sync-pacing-model';

/** Every value the form can send, in one flat shape. */
export interface SyncPacingValues {
  readonly catalogueSweepBudget: number;
  readonly inventorySweepBudget: number;
  readonly sweepPageSize: number;
  readonly deletionAuditBudget: number;
  readonly deletionAuditCadence: string;
}

export interface SyncPacingChange {
  readonly field: OperationalSettingField;
  /** Operator-facing name of what moved. */
  readonly label: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  /** One sentence about what this change does, in the operator's terms. */
  readonly effect: string;
  /**
   * When this change lands, if it is not straight away.
   *
   * Informational, never a warning: it says WHEN the change takes effect, not
   * that it might hurt. Only the deletion-audit cadence carries one today,
   * and only because the API said so - see `SyncPacingDiffContext`.
   */
  readonly timing?: string;
  /**
   * Set when this change takes the value past OpenLinker's RECOMMENDED
   * ceiling.
   *
   * The modal is where the decision is taken, and raising a value past our
   * advice is a different decision from moving it inside the range - so the
   * entry has to say which ceiling was crossed rather than reading like any
   * other edit. `reason` is the API's own sentence; a sentence written here
   * would drift from it.
   */
  readonly aboveRecommended?: {
    readonly recommendedMax: number;
    readonly reason: string | null;
  };
}

export interface SyncPacingDiff {
  readonly changes: readonly SyncPacingChange[];
  /**
   * A deleted product can now keep selling for longer than before.
   *
   * Derived from the projection rather than from which field moved, because
   * either half of the audit — how many per run, or how often — produces it,
   * and both together can cancel out.
   */
  readonly lengthensDeletionWindow: boolean;
}

export interface SyncPacingDiffContext {
  readonly hostProcessLimitSeconds: number;
  readonly catalogueSize: number | null;
  /**
   * The sweep cadences the API reported, as cron expressions. Threaded so a
   * pass-length sentence in the confirm dialog uses the cadence in force
   * rather than the shipped one (#2660 review); absent falls back, exactly as
   * the projection does.
   */
  readonly catalogueSweepCadence?: string;
  readonly inventorySweepCadence?: string;
  /**
   * The API's own answer for when a cadence change starts applying
   * (`OperationalSettingsView.cadenceAppliesAt`). The note is emitted from
   * what the server reported, never assumed - a build that does not
   * recognise the value says nothing rather than guessing.
   */
  readonly cadenceAppliesAt?: string;
  /**
   * The ceilings the API reported, per numeric field. Absent for a response
   * that carried none - the diff then says nothing about ceilings rather
   * than inventing one.
   */
  readonly limits?: Partial<Record<OperationalSettingKey, ValueLimits>>;
}

/**
 * The one `cadenceAppliesAt` value this build understands. Anything else
 * (including a future value) produces no note.
 */
export const CADENCE_APPLIES_AT_NEXT_SCHEDULER_START = 'next-scheduler-start';

/**
 * Deliberately claims no duration. The API reports THAT a cadence waits for
 * the background service, never how long that takes, and an invented "within
 * a minute" is a promise nothing here can keep. Read when called, so it
 * follows the active language.
 */
export function cadenceTimingNote(): string {
  return getMessages('settings').syncPacingChanges.cadenceTimingNote;
}

function projectionFor(
  values: SyncPacingValues,
  context: SyncPacingDiffContext
): SyncPacingProjection {
  return projectSyncPacing({
    catalogueSweepBudget: values.catalogueSweepBudget,
    inventorySweepBudget: values.inventorySweepBudget,
    deletionAuditBudget: values.deletionAuditBudget,
    deletionAuditCadence: values.deletionAuditCadence,
    hostProcessLimitSeconds: context.hostProcessLimitSeconds,
    catalogueSize: context.catalogueSize,
    catalogueSweepCadence: context.catalogueSweepCadence,
    inventorySweepCadence: context.inventorySweepCadence,
  });
}

type PassKind = 'cataloguePass' | 'stockPass' | 'deletionWindow';

function passSentence(before: number | null, after: number | null, kind: PassKind): string {
  const copy = getMessages('settings').syncPacingChanges[kind];
  const from = formatDays(before);
  const to = formatDays(after);
  if (from === null || to === null) {
    return copy.unknown;
  }
  if (from === to) {
    return interpolate(copy.same, { to });
  }
  return interpolate(copy.changed, { from, to });
}

/**
 * How long the deletion window is, relative to the catalogue size — a plain
 * ratio, so the comparison holds even when the catalogue size is unknown and
 * the absolute window cannot be stated.
 *
 * `null` when the cadence cannot be read, in which case no claim is made in
 * either direction.
 */
function deletionWindowFactor(values: SyncPacingValues): number | null {
  const minutes = readCadenceIntervalMinutes(values.deletionAuditCadence);
  if (minutes === null || values.deletionAuditBudget <= 0) {
    return null;
  }
  return minutes / values.deletionAuditBudget;
}

/**
 * Whether this change lands past our recommendation, and the API's reason.
 *
 * Reports only when the NEW value crosses it. A value that was already above
 * the recommendation and is being lowered - still above, but moving the right
 * way - is not a fresh crossing, and flagging it would make the modal cry wolf
 * on the one edit that improves matters.
 */
function crossingFor(
  key: OperationalSettingKey,
  value: number,
  context: SyncPacingDiffContext
): SyncPacingChange['aboveRecommended'] {
  const limits = context.limits?.[key];
  if (limits === undefined || !isAboveRecommended(value, limits)) {
    return undefined;
  }
  return {
    recommendedMax: limits.recommendedMax ?? value,
    reason: limits.recommendedReason,
  };
}

export function diffSyncPacing(
  saved: SyncPacingValues,
  draft: SyncPacingValues,
  context: SyncPacingDiffContext
): SyncPacingDiff {
  const before = projectionFor(saved, context);
  const after = projectionFor(draft, context);
  const changes: SyncPacingChange[] = [];
  const copy = getMessages('settings').syncPacingChanges;

  if (draft.catalogueSweepBudget !== saved.catalogueSweepBudget) {
    const fits = after.catalogueRunSeconds <= context.hostProcessLimitSeconds;
    changes.push({
      field: 'catalogueSweepBudget',
      label: copy.catalogueSweepBudget.label,
      aboveRecommended: crossingFor('catalogueSweepBudget', draft.catalogueSweepBudget, context),
      fromLabel: String(saved.catalogueSweepBudget),
      toLabel: String(draft.catalogueSweepBudget),
      effect: [
        interpolate(copy.catalogueSweepBudget.runChange, {
          from: formatSeconds(before.catalogueRunSeconds),
          to: formatSeconds(after.catalogueRunSeconds),
        }),
        passSentence(before.cataloguePassDays, after.cataloguePassDays, 'cataloguePass'),
        interpolate(
          fits ? copy.catalogueSweepBudget.hostLimitFits : copy.catalogueSweepBudget.hostLimitExceeded,
          { limit: formatSeconds(context.hostProcessLimitSeconds) }
        ),
      ].join(' '),
    });
  }

  if (draft.inventorySweepBudget !== saved.inventorySweepBudget) {
    changes.push({
      field: 'inventorySweepBudget',
      label: copy.inventorySweepBudget.label,
      aboveRecommended: crossingFor('inventorySweepBudget', draft.inventorySweepBudget, context),
      fromLabel: String(saved.inventorySweepBudget),
      toLabel: String(draft.inventorySweepBudget),
      effect: [
        interpolate(copy.inventorySweepBudget.requestChange, {
          to: String(after.stockRequestsPerRun),
          from: String(before.stockRequestsPerRun),
        }),
        passSentence(before.stockPassDays, after.stockPassDays, 'stockPass'),
      ].join(' '),
    });
  }

  if (draft.sweepPageSize !== saved.sweepPageSize) {
    changes.push({
      field: 'sweepPageSize',
      label: copy.sweepPageSize.label,
      aboveRecommended: crossingFor('sweepPageSize', draft.sweepPageSize, context),
      fromLabel: String(saved.sweepPageSize),
      toLabel: String(draft.sweepPageSize),
      effect: [
        interpolate(copy.sweepPageSize.pageChange, {
          to: String(draft.sweepPageSize),
          from: String(saved.sweepPageSize),
        }),
        copy.sweepPageSize.fewerMeansMore,
      ].join(' '),
    });
  }

  if (draft.deletionAuditBudget !== saved.deletionAuditBudget) {
    changes.push({
      field: 'deletionAuditBudget',
      label: copy.deletionAuditBudget.label,
      aboveRecommended: crossingFor('deletionAuditBudget', draft.deletionAuditBudget, context),
      fromLabel: String(saved.deletionAuditBudget),
      toLabel: String(draft.deletionAuditBudget),
      effect: passSentence(
        before.deletionWindowDays,
        after.deletionWindowDays,
        'deletionWindow'
      ),
    });
  }

  if (draft.deletionAuditCadence !== saved.deletionAuditCadence) {
    changes.push({
      field: 'deletionAuditCadence',
      label: copy.deletionAuditCadence.label,
      fromLabel: describeCadence(saved.deletionAuditCadence),
      toLabel: describeCadence(draft.deletionAuditCadence),
      effect: passSentence(
        before.deletionWindowDays,
        after.deletionWindowDays,
        'deletionWindow'
      ),
      timing:
        context.cadenceAppliesAt === CADENCE_APPLIES_AT_NEXT_SCHEDULER_START
          ? copy.cadenceTimingNote
          : undefined,
    });
  }

  const beforeFactor = deletionWindowFactor(saved);
  const afterFactor = deletionWindowFactor(draft);

  return {
    changes,
    lengthensDeletionWindow:
      beforeFactor !== null && afterFactor !== null && afterFactor > beforeFactor,
  };
}
