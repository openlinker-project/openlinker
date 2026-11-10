/**
 * Sync Progress Copy (#4024)
 *
 * Builds the page's copy from the `cursors` namespace (locales/{en,pl}/cursors.json,
 * ADR-081): plain strings pass through, templates become functions, counts use
 * the locale's plural rules. Pure, so the lib functions that need copy take it
 * as an argument instead of reading a module-level constant.
 *
 * @module apps/web/src/features/cursors/lib
 */
import {
  formatPlural,
  getBcp47Locale,
  interpolate,
  useActiveLocale,
  useMessages,
  type Messages,
} from '../../../shared/i18n';
import type { SupportedLocale } from '../../../shared/i18n/i18n.types';

type Raw = Messages['cursors'];
type RunStatus = 'queued' | 'running' | 'succeeded' | 'dead';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the return type IS the copy contract; `SyncProgressCopy` below derives from it
export function buildSyncProgressCopy(raw: Raw, locale: SupportedLocale) {
  const m = raw.syncProgress;
  const count = (value: number): string => value.toLocaleString(getBcp47Locale(locale));
  return {
    ...m,
    needsLookTitle: (n: number): string => formatPlural(n, m.needsLookTitle, locale),
    showAllProblems: (n: number): string => interpolate(m.showAllProblems, { n }),
    verdictNeedLook: (n: number): string => formatPlural(n, m.verdictNeedLook, locale),
    pushesNote: (name: string): string => interpolate(m.pushesNote, { name }),
    lastRunOk: (ago: string): string => interpolate(m.lastRunOk, { ago }),
    lastRunFailed: (ago: string): string => interpolate(m.lastRunFailed, { ago }),
    writeMarks: (n: number): string => formatPlural(n, m.writeMarks, locale),
    writeMarksRange: (newest: string, oldest: string): string =>
      interpolate(m.writeMarksRange, { newest, oldest }),
    writeMarksMore: (shown: number, total: number): string =>
      interpolate(m.writeMarksMore, { shown, total: count(total) }),
    healthWhy: {
      late: (ago: string, every: number): string => interpolate(m.healthWhy.late, { ago, every }),
      stuck: (when: string, every: number): string =>
        interpolate(m.healthWhy.stuck, { when, every }),
      failing: (error: string): string => interpolate(m.healthWhy.failing, { error }),
      failingNoError: m.healthWhy.failingNoError,
      misplaced: (keyPlatform: string, connPlatform: string): string =>
        interpolate(m.healthWhy.misplaced, { keyPlatform, connPlatform }),
    },
    progress: {
      ...m.progress,
      passDoneAgo: (ago: string): string => interpolate(m.progress.passDoneAgo, { ago }),
      passInProgress: (n: number): string => formatPlural(n, m.progress.passInProgress, locale),
      checkedUpTo: (n: number): string => interpolate(m.progress.checkedUpTo, { n: count(n) }),
      readUpTo: (when: string): string => interpolate(m.progress.readUpTo, { when }),
      stockSent: (ago: string): string => interpolate(m.progress.stockSent, { ago }),
      stamped: (when: string): string => interpolate(m.progress.stamped, { when }),
    },
    sheet: {
      ...m.sheet,
      everyMinutes: (n: number): string => interpolate(m.sheet.everyMinutes, { n }),
      lastRunValue: (status: RunStatus, ago: string): string =>
        interpolate(m.sheet.lastRunValue[status], { ago }),
      runFailed: (message: string): string => interpolate(m.sheet.runFailed, { message }),
    },
    rewind: {
      ...m.rewind,
      failed: (message: string): string => interpolate(m.rewind.failed, { message }),
    },
  };
}

export type SyncProgressCopy = ReturnType<typeof buildSyncProgressCopy>;

export function useSyncProgressCopy(): SyncProgressCopy {
  return buildSyncProgressCopy(useMessages('cursors'), useActiveLocale());
}
