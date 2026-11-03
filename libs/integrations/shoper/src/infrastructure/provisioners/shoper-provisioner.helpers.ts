/**
 * Shoper Provisioner Helpers
 *
 * Pure helpers for the customer provisioner: a PII-free lock-key token and a
 * bounded-wait acquisition built on the host `SyncLockPort`.
 *
 * @module libs/integrations/shoper/src/infrastructure/provisioners
 */
import { createHash } from 'crypto';
import type { SyncLockPort, SyncLockToken } from '@openlinker/core/sync';

/** Lock TTL: ample for the two Shoper round-trips a provision costs. */
export const PROVISIONER_LOCK_TTL_MS = 30_000;

const MAX_ACQUIRE_ATTEMPTS = 20;
const ACQUIRE_DELAY_MS = 100;

/** Plain SHA-256 so a raw email never enters the lock key space. */
export function lockKeyToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function acquireLockWithWait(
  syncLock: SyncLockPort,
  key: string,
  ttlMs: number = PROVISIONER_LOCK_TTL_MS,
  maxAttempts: number = MAX_ACQUIRE_ATTEMPTS,
  delayMs: number = ACQUIRE_DELAY_MS,
): Promise<SyncLockToken | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const token = await syncLock.acquire(key, ttlMs);
    if (token) {
      return token;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}
