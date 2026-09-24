/**
 * Bench presence service contract (#3406, mockup-parity epic #3401)
 *
 * @module apps/api/src/bench/application/interfaces
 */
import type { BenchPresenceView } from '../types/bench-presence.types';

export const BENCH_PRESENCE_SERVICE_TOKEN = Symbol('IBenchPresenceService');

export interface IBenchPresenceService {
  /**
   * Announce that `userId` is viewing `workId` right now, and report whether
   * someone else was too.
   *
   * Call it on open and refresh it on an interval while the parcel view stays
   * mounted (the same cadence D4's polling interrupt already runs on, so no
   * new timer is introduced client-side) — the FE's concern, not this one's.
   */
  ping(workId: string, userId: string): Promise<BenchPresenceView>;
}
