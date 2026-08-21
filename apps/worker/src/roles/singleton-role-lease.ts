/**
 * Singleton Role Lease
 *
 * Acquire-or-park lease over a `SyncLockPort` lock for a responsibility that
 * must run on AT MOST ONE process (#2279, ADR-051): every replica ticks; the
 * holder extends its lease (compare-and-PEXPIRE) well before expiry, and the
 * others retry acquisition so the responsibility fails over after the holder
 * dies. **The failover bound is ⁴⁄₃ TTL, not one TTL**: the lock must first
 * expire in Redis (one TTL), and a competitor only notices on its next tick
 * (up to TTL/3 later). Size the TTL from that number.
 *
 * Not `@Injectable` — a plain helper the owning coordinator constructs, so two
 * singletons in one process each get their own lease with their own key.
 *
 * Guarantees pinned by the spec:
 * - the tick interval is TTL/3, floored at 1 s, and `unref()`d so an idle
 *   process can exit;
 * - ticks never overlap: a tick that fires while the previous async tick is
 *   still in flight is absorbed (a slow Redis must not stack acquires);
 * - `extend === false` means the lease is LOST (expired or claimed elsewhere):
 *   `onLost` fires once and the process goes back to competing;
 * - a *throwing* extend is not loss on its own — the lock is still there and
 *   the next tick retries inside the same TTL — but that premise expires:
 *   once no acquire/extend has been CONFIRMED for a whole TTL the lock has
 *   provably lapsed in Redis, so the holder self-demotes rather than running
 *   alongside whoever legitimately took it (the partition case);
 * - `start()`/`stop()` are idempotent; `stop()` releases a held lock
 *   best-effort so failover does not wait out the TTL on graceful shutdown,
 *   and a `stop()` that races an in-flight acquire never leaves a token (or a
 *   started responsibility) behind.
 *
 * @module apps/worker/src/roles
 */
import type { SyncLockPort, SyncLockToken } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

export interface SingletonRoleLeaseOptions {
  /** Lock key, e.g. `singleton:scheduler`. */
  readonly lockKey: string;
  /** Lease TTL in milliseconds; the tick interval is derived as TTL/3. */
  readonly ttlMs: number;
  readonly syncLock: SyncLockPort;
  /** Fired when this process wins the lease. May be async; awaited per tick. */
  readonly onAcquired: () => void | Promise<void>;
  /** Fired when a held lease is lost (expiry/claim elsewhere) or released. */
  readonly onLost: () => void | Promise<void>;
}

export class SingletonRoleLease {
  private readonly logger = new Logger(SingletonRoleLease.name);
  private timer: NodeJS.Timeout | null = null;
  private token: SyncLockToken | null = null;
  private tickInFlight = false;
  private stopped = false;
  /**
   * When Redis last CONFIRMED this process holds the lock (acquire or a
   * successful extend). Distinct from "the last tick ran": a tick whose extend
   * threw confirms nothing, and it is exactly that case the demotion deadline
   * below is measured against.
   */
  private lastConfirmedHoldAt: number | null = null;

  constructor(private readonly options: SingletonRoleLeaseOptions) {}

  /** Whether this process currently holds the lease. */
  isHolding(): boolean {
    return this.token !== null;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.stopped = false;
    const intervalMs = Math.max(1_000, Math.floor(this.options.ttlMs / 3));
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    // Compete immediately rather than waiting one interval.
    void this.tick();
  }

  async stop(): Promise<void> {
    // Set FIRST: an acquire already awaiting Redis re-checks this after its
    // await and releases instead of starting the responsibility during
    // teardown (which would both leak timers and hold the lock with nothing
    // left to extend or release it — failover would then wait out the TTL).
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.token !== null) {
      const token = this.token;
      this.token = null;
      this.lastConfirmedHoldAt = null;
      try {
        await this.options.syncLock.release(this.options.lockKey, token);
      } catch (error) {
        this.logger.warn(
          `Failed to release lease ${this.options.lockKey} on stop (expires by TTL): ${error instanceof Error ? error.message : String(error)}`
        );
      }
      await this.safeOnLost();
    }
  }

  private async tick(): Promise<void> {
    if (this.tickInFlight) {
      // A slow Redis round-trip must not stack concurrent acquire/extend
      // attempts — absorb the tick (pinned by spec).
      return;
    }
    this.tickInFlight = true;
    try {
      if (this.token === null) {
        await this.tryAcquire();
      } else {
        await this.tryExtend();
      }
    } catch (error) {
      // A Redis blip while HOLDING is not loss on its own — the lock is still
      // there and the next tick retries the extend inside the same TTL. Only
      // an explicit `false` from extend means the lease moved... but that
      // premise has a deadline, enforced below.
      this.logger.warn(
        `Lease tick failed for ${this.options.lockKey} (retrying next tick): ${error instanceof Error ? error.message : String(error)}`
      );
      await this.demoteIfHoldUnconfirmed();
    } finally {
      this.tickInFlight = false;
    }
  }

  /**
   * Self-demote once no acquire/extend has been confirmed for a full TTL.
   *
   * Without this, a replica partitioned from Redis (but not from the rest of
   * the world) keeps its responsibility running forever on one `warn` per
   * tick, while a peer legitimately acquires the expired lock — two active
   * holders, which is the one thing the lease exists to prevent. Past one TTL
   * with no confirmation the lock has provably lapsed, so continuing to act as
   * the holder is a claim this process cannot support.
   */
  private async demoteIfHoldUnconfirmed(): Promise<void> {
    if (this.token === null || this.lastConfirmedHoldAt === null) {
      return;
    }
    if (Date.now() - this.lastConfirmedHoldAt < this.options.ttlMs) {
      return;
    }
    this.logger.error(
      `Lease ${this.options.lockKey} unconfirmed for ${this.options.ttlMs}ms — demoting (the lock has expired in Redis and may be held elsewhere)`
    );
    this.token = null;
    this.lastConfirmedHoldAt = null;
    await this.safeOnLost();
  }

  private async tryAcquire(): Promise<void> {
    const token = await this.options.syncLock.acquire(this.options.lockKey, this.options.ttlMs);
    if (token === null) {
      return; // Parked — another process holds it; keep competing.
    }
    if (this.stopped) {
      // `stop()` ran while this acquire was in flight. Starting the
      // responsibility now would run it during teardown and strand the lock
      // for a full TTL — release and stay down.
      try {
        await this.options.syncLock.release(this.options.lockKey, token);
      } catch {
        // Expires by TTL.
      }
      return;
    }
    this.token = token;
    this.lastConfirmedHoldAt = Date.now();
    this.logger.log(`Acquired singleton lease: ${this.options.lockKey}`);
    try {
      await this.options.onAcquired();
    } catch (error) {
      this.logger.error(
        `onAcquired failed for lease ${this.options.lockKey} — releasing so another process can take it`,
        error instanceof Error ? error.stack : String(error)
      );
      const held = this.token;
      this.token = null;
      this.lastConfirmedHoldAt = null;
      if (held !== null) {
        try {
          await this.options.syncLock.release(this.options.lockKey, held);
        } catch {
          // Expires by TTL.
        }
      }
      // The owner must be told the responsibility is NOT running, or its own
      // `started` latch stays set and the next acquisition is a silent no-op.
      await this.safeOnLost();
    }
  }

  private async tryExtend(): Promise<void> {
    const token = this.token;
    if (token === null) {
      return;
    }
    const extended = await this.options.syncLock.extend(
      this.options.lockKey,
      token,
      this.options.ttlMs
    );
    if (!extended) {
      this.logger.warn(`Lost singleton lease: ${this.options.lockKey}`);
      this.token = null;
      this.lastConfirmedHoldAt = null;
      await this.safeOnLost();
      return;
    }
    this.lastConfirmedHoldAt = Date.now();
  }

  private async safeOnLost(): Promise<void> {
    try {
      await this.options.onLost();
    } catch (error) {
      this.logger.error(
        `onLost failed for lease ${this.options.lockKey}`,
        error instanceof Error ? error.stack : String(error)
      );
    }
  }
}
