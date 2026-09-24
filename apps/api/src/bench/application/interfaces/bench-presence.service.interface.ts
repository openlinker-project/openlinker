/**
 * Bench presence service contract (#3406; widened to a named roster by
 * #3415, mockup-parity epic #3401)
 *
 * @module apps/api/src/bench/application/interfaces
 */
import type { BenchPresenceView } from '../types/bench-presence.types';

export const BENCH_PRESENCE_SERVICE_TOKEN = Symbol('IBenchPresenceService');

export interface IBenchPresenceService {
  /**
   * Announce that `userId` is viewing `workId` right now, and report who
   * ELSE is.
   *
   * Call it on open and refresh it on an interval while the parcel view
   * stays mounted (the same cadence D4's polling interrupt already runs on,
   * so no new timer is introduced client-side) — the FE's concern, not this
   * one's.
   *
   * `displayName` is the caller's own name as the VERIFIED TOKEN reports it,
   * never a value from the request body: presence names a colleague to a
   * colleague, and a name a client could supply is a name a client could
   * forge. It is masked before it is stored, so the raw value never leaves
   * this call.
   */
  ping(workId: string, userId: string, displayName: string): Promise<BenchPresenceView>;
}
