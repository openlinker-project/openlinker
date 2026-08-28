/**
 * Deletion Audit Cadence Options
 *
 * The cadences the page offers, and the operator-facing name for each. The
 * API stores a cron expression; an operator does not think in cron, so the
 * control is a list of intervals and the expression stays an implementation
 * detail of this module.
 *
 * Nothing here can express "never". The deletion audit is the deletion
 * authority (#2222) and switching it off silently reopens a deleted product
 * whose offers keep selling (#1689), so the longest option on the list is a
 * day — well inside the server's own once-every-7-days floor.
 *
 * A cadence that is not on the list (an operator's env var, or a value set
 * before the list changed) is not discarded: `resolveCadenceOptions` appends
 * it so the control can show what is actually in force rather than silently
 * snapping the operator onto a neighbouring value.
 *
 * @module apps/web/src/features/settings/lib
 */
import { readCadenceIntervalMinutes } from './sync-pacing-model';

export interface CadenceOption {
  /** The cron expression the API stores. */
  readonly value: string;
  /** What the operator reads, in the control and in the confirmation. */
  readonly label: string;
}

export const DELETION_AUDIT_CADENCE_OPTIONS: readonly CadenceOption[] = [
  { value: '*/15 * * * *', label: 'Every 15 minutes' },
  { value: '*/30 * * * *', label: 'Every 30 minutes' },
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 */4 * * *', label: 'Every 4 hours' },
  { value: '0 3 * * *', label: 'Once a day' },
];

/**
 * The offered cadences, plus the one currently in force when it is not among
 * them.
 */
export function resolveCadenceOptions(current: string): readonly CadenceOption[] {
  const known = DELETION_AUDIT_CADENCE_OPTIONS.some((option) => option.value === current);
  if (known) {
    return DELETION_AUDIT_CADENCE_OPTIONS;
  }
  return [...DELETION_AUDIT_CADENCE_OPTIONS, { value: current, label: describeCadence(current) }];
}

/**
 * An operator-facing name for a cadence, falling back to a plain reading of
 * the interval and finally to the raw expression — which is at least true,
 * where inventing a friendly name for something unparsed would not be.
 */
export function describeCadence(expression: string): string {
  const known = DELETION_AUDIT_CADENCE_OPTIONS.find((option) => option.value === expression);
  if (known) {
    return known.label;
  }
  const minutes = readCadenceIntervalMinutes(expression);
  if (minutes === null) {
    return expression;
  }
  if (minutes < 60) {
    return `Every ${String(minutes)} minutes`;
  }
  if (minutes < 1440) {
    const hours = minutes / 60;
    return hours === 1 ? 'Every hour' : `Every ${String(hours)} hours`;
  }
  return 'Once a day';
}
