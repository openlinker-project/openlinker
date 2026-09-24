/**
 * Packer presence rule (#3424, mockup-parity epic #3401)
 *
 * The one place that answers "is this packer at a bench right now". The
 * Assign Packing Work board renders the verdict per swimlane, so it must have
 * exactly one definition: two thresholds in two files is how one screen comes
 * to disagree with another about the same person.
 *
 * `online` is DERIVED on every read and never stored. A stored boolean would
 * need something to flip it back off, and nothing would - a packer who closes
 * the tab, loses the network or goes home sends no "leaving" signal, so a
 * persisted flag would report the whole warehouse as permanently on shift.
 *
 * The heartbeat behind it is bumped by BENCH ACTIVITY and never by a login or
 * session event, which is what makes a signed-in but idle account read as
 * offline rather than as staffed.
 *
 * @module libs/core/src/users/domain/types
 */

/**
 * How long after a packer's last bench action they still read as online.
 *
 * Five minutes: long enough to cover a packer taping a large box, fetching a
 * pallet or answering a question without flickering offline mid-parcel, and
 * short enough that a bench abandoned at the end of a shift stops advertising
 * itself as staffed before the next supervisor looks at the board.
 *
 * It is deliberately far LONGER than the bench's own 30 s presence TTL
 * (`BenchPresenceService`), which answers a different question - "is somebody
 * looking at THIS parcel right now", where a stale answer names the wrong
 * colleague in a collision banner. Here a stale answer only misjudges
 * staffing by a few minutes, so the two must not share a constant.
 */
export const PACKER_PRESENCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Whether `lastActiveAt` is recent enough to read as online.
 *
 * `null` is offline, not unknown: an account that has never touched a bench
 * is not at one, and rendering a third "unknown" state would ask a supervisor
 * to interpret something the board cannot resolve for them.
 *
 * A stamp in the FUTURE reads as online rather than being rejected. It should
 * not occur - the column is stamped by Postgres's own clock (#2071's rule) -
 * and if it somehow does, treating it as offline would hide a packer who is
 * demonstrably active.
 */
export function isPackerOnline(lastActiveAt: Date | null, now: Date = new Date()): boolean {
  if (lastActiveAt === null) return false;
  return now.getTime() - lastActiveAt.getTime() < PACKER_PRESENCE_WINDOW_MS;
}
