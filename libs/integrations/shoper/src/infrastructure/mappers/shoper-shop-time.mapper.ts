/**
 * Shoper Shop Time Mapper
 *
 * Turns a UTC instant into the naive, shop-local `YYYY-MM-DD HH:MM:SS` Shoper
 * compares its timestamps against (the inverse of `shopLocalToIso`). Used to
 * render a `>=` lower bound for a filter such as `edit_date`, so every rule here
 * errs towards an EARLIER reading: a bound that is too early re-reads a few
 * rows, which is free because every consumer is idempotent, while a bound that
 * is too late silently skips changes.
 *
 * Three cases are widened on purpose:
 *   - **Unknown or unusable zone.** Without `locale_timezone` (or with a value
 *     `Intl` rejects) the instant is rendered in UTC minus 14 hours, the
 *     earliest wall clock any zone on Earth shows for it. Reading it as plain
 *     UTC would skip changes on a shop west of Greenwich.
 *   - **A clock that turns back soon after the instant.** At a DST fall-back the
 *     wall clock repeats an hour, so a change made after the instant can carry an
 *     EARLIER wall-clock reading than the bound. When the zone's offset drops
 *     within the following hour, the bound moves back by that drop.
 *   - **Sub-second precision.** Shoper stores whole seconds, so the bound is
 *     truncated, never rounded up.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */

/** UTC+14 (Line Islands) is the furthest-ahead zone, so 14 h back is always early enough. */
const MAX_ZONE_AHEAD_MS = 14 * 60 * 60 * 1000;

/** How far ahead a backward clock change is looked for; DST shifts are at most an hour. */
const TRANSITION_LOOKAHEAD_MS = 60 * 60 * 1000;

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * The `>=` bound for a Shoper timestamp filter, as the shop's local wall clock.
 * `timeZone` is the shop's IANA zone (`application-config.locale_timezone`).
 */
export function toShoperLocalBound(instant: Date, timeZone: string | null): string {
  const utcMs = Math.floor(instant.getTime() / 1000) * 1000;
  if (timeZone === null) {
    return format(wallClockUtc(utcMs - MAX_ZONE_AHEAD_MS));
  }
  try {
    const drop = Math.max(
      0,
      offsetMs(utcMs, timeZone) - offsetMs(utcMs + TRANSITION_LOOKAHEAD_MS, timeZone),
    );
    return format(wallClockIn(utcMs - drop, timeZone));
  } catch {
    return format(wallClockUtc(utcMs - MAX_ZONE_AHEAD_MS));
  }
}

function wallClockIn(utcMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function wallClockUtc(utcMs: number): WallClock {
  const date = new Date(utcMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`. */
function offsetMs(utcMs: number, timeZone: string): number {
  const wall = wallClockIn(utcMs, timeZone);
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

function format(wall: WallClock): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${String(wall.year).padStart(4, '0')}-${pad(wall.month)}-${pad(wall.day)} ` +
    `${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`
  );
}
