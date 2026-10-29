/**
 * Date windows for the G11 suite (#3591)
 *
 * Shop clocks and the worker's clock are not the same clock, so a window that
 * is "exactly today" misses an order the shop stamped a few hours off. Every
 * live scenario reads through a window that starts two days back and ends two
 * days ahead of the run, and compares DELTAS, never absolute totals - the stand
 * is shared with whatever else ran on it.
 *
 * @module support/g11
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDay(offsetDays = 0, now = new Date()): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** `[from, to)` as `yyyy-mm-dd` covering the run with slack on both sides. */
export function liveWindow(): { from: string; to: string } {
  return { from: utcDay(-2), to: utcDay(3) };
}

/** Exactly `days` days, the API's own arithmetic: `(to - from) / day`. */
export function windowOfDays(days: number, endDay = utcDay(3)): { from: string; to: string } {
  const end = new Date(`${endDay}T00:00:00.000Z`);
  return { from: new Date(end.getTime() - days * DAY_MS).toISOString().slice(0, 10), to: endDay };
}
