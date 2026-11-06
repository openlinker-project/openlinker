/**
 * Read Cursor Health + Progress (#4024)
 *
 * Health is judged on TIME against the cursor's expected cadence, never on its
 * value: an empty catalogue cursor is the normal resting state between passes,
 * and reading it as a problem is exactly the confusion this page replaced.
 *
 * Precedence: wrong connection, then a failed last run, then lateness. A
 * misplaced key's progress is not trustworthy whatever its timing, and a
 * failing run explains lateness better than the lateness does.
 *
 * @module apps/web/src/features/cursors/lib
 */
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { CursorOverviewItem } from '../api/cursors.types';
import { describeCursor } from './cursor-catalogue';
import type { SyncProgressCopy } from './sync-progress-copy';

export const CursorHealthValues = ['ok', 'plain', 'late', 'stuck', 'failing', 'misplaced'] as const;
export type CursorHealthId = (typeof CursorHealthValues)[number];

export interface CursorHealth {
  id: CursorHealthId;
  label: string;
  tone: StatusBadgeTone;
  why: string | null;
  guideId: string;
}

/** Moved within this many intervals reads On time. */
export const LATE_AFTER_INTERVALS = 2;
/** Not moved for more than this many intervals reads Not moving. */
export const STUCK_AFTER_INTERVALS = 6;

export function isProblem(health: CursorHealth): boolean {
  return health.id === 'late' || health.id === 'stuck' || health.id === 'failing' || health.id === 'misplaced';
}

export function readCursorHealth(
  cursor: CursorOverviewItem,
  connectionPlatform: string | null,
  now: number,
  ago: (iso: string) => string,
  formatWhen: (iso: string) => string,
  C: SyncProgressCopy,
): CursorHealth {
  const d = describeCursor(cursor.cursorKey);
  // `subiekt` owns both `subiekt-gt` and `subiekt-nexo`: compare the family, not the exact type.
  if (d.platform && connectionPlatform && connectionPlatform.split('-')[0] !== d.platform) {
    return { id: 'misplaced', label: C.healthLabel.misplaced, tone: 'error', why: C.healthWhy.misplaced(d.platform, connectionPlatform), guideId: 'h-misplaced' };
  }
  if (cursor.lastRun?.status === 'dead') {
    return {
      id: 'failing',
      label: C.healthLabel.failing,
      tone: 'error',
      why: cursor.lastRun.lastError ? C.healthWhy.failing(firstLine(cursor.lastRun.lastError)) : C.healthWhy.failingNoError,
      guideId: 'h-failing',
    };
  }
  if (d.cadenceMinutes === null) {
    return { id: 'plain', label: C.healthLabel.plain, tone: 'neutral', why: null, guideId: 'h-plain' };
  }
  if (cursor.family === 'sweep-cycle' && cursor.value === '') {
    return { id: 'ok', label: C.healthLabel.ok, tone: 'success', why: null, guideId: 'h-ok' };
  }
  // A run that succeeded but found nothing new leaves the value - and so its
  // `updatedAt` - untouched (a re-check over an empty set stays at 0). The
  // sync is still on schedule, so its last successful (or running) run counts as a move.
  const lastSeen = latestOf(cursor.updatedAt, cursor.lastRun && (cursor.lastRun.status === 'succeeded' || cursor.lastRun.status === 'running') ? cursor.lastRun.at : null);
  const minutes = (now - Date.parse(lastSeen)) / 60_000;
  if (minutes > d.cadenceMinutes * STUCK_AFTER_INTERVALS) {
    return { id: 'stuck', label: C.healthLabel.stuck, tone: 'warning', why: C.healthWhy.stuck(formatWhen(lastSeen), d.cadenceMinutes), guideId: 'h-stuck' };
  }
  if (minutes > d.cadenceMinutes * LATE_AFTER_INTERVALS) {
    return { id: 'late', label: C.healthLabel.late, tone: 'warning', why: C.healthWhy.late(ago(lastSeen), d.cadenceMinutes), guideId: 'h-late' };
  }
  return { id: 'ok', label: C.healthLabel.ok, tone: 'success', why: null, guideId: 'h-ok' };
}

export interface CursorProgress {
  main: string;
  sub: string | null;
  /** Main line is an absence (rendered muted). */
  empty: boolean;
  guideId: string;
  parsedPass: { cycleId: string; offset: number } | null;
}

/**
 * The operator sentence for where a cursor is. `passDoneAt` is the matching
 * `completedAt` stamp for a catalogue cursor, when one exists.
 */
export function readCursorProgress(
  cursor: CursorOverviewItem,
  passDoneAt: string | null,
  ago: (iso: string) => string,
  formatWhen: (iso: string) => string,
  C: SyncProgressCopy,
): CursorProgress {
  const P = C.progress;
  const v = cursor.value;
  switch (cursor.family) {
    case 'sweep-cycle': {
      if (v === '') {
        return { main: P.passFinished, sub: passDoneAt ? P.passDoneAgo(ago(passDoneAt)) : P.passNextOnSchedule, empty: true, guideId: 'p-finished', parsedPass: null };
      }
      const sep = v.lastIndexOf(':');
      const offset = Number(v.slice(sep + 1));
      const cycleId = v.slice(0, sep);
      if (sep < 0 || !Number.isFinite(offset)) break;
      return { main: P.passInProgress(offset), sub: P.passContinues, empty: false, guideId: 'p-inprogress', parsedPass: { cycleId, offset } };
    }
    case 'rolling-offset': {
      const n = Number(v);
      if (v === '') return { main: P.notStarted, sub: P.waitingFirstRun, empty: true, guideId: 'p-notstarted', parsedPass: null };
      if (Number.isFinite(n)) return { main: P.checkedUpTo(n), sub: P.startsOver, empty: false, guideId: 'p-checked', parsedPass: null };
      break;
    }
    case 'write-order':
      if (v !== '' && !Number.isNaN(Date.parse(v))) return { main: P.stockSent(ago(v)), sub: null, empty: false, guideId: 'p-stock', parsedPass: null };
      break;
    case 'completion-stamp':
      if (v !== '' && !Number.isNaN(Date.parse(v))) return { main: P.stamped(formatWhen(v)), sub: null, empty: false, guideId: 'k-completion-stamp', parsedPass: null };
      break;
    default:
      break;
  }
  if (v === '') return { main: P.notStarted, sub: P.waitingFirstRun, empty: true, guideId: 'p-notstarted', parsedPass: null };
  // A feed cursor is the platform's own format; the only honest statement
  // about it is WHEN it last moved, not what the value means.
  return { main: P.readUpTo(formatWhen(cursor.updatedAt)), sub: null, empty: false, guideId: 'p-readupto', parsedPass: null };
}

function latestOf(a: string, b: string | null): string {
  return b !== null && Date.parse(b) > Date.parse(a) ? b : a;
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? text;
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
