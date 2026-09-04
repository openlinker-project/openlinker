/**
 * Pending-gesture log (#2416, `W3b-3`, designed for G3 / #2420)
 *
 * A per-gesture id, minted client-side and made DURABLE before the gesture is
 * handed to a consumer.
 *
 * ## Why identity cannot be the payload
 *
 * G3 — *"a legitimate second scan, the second unit of a two-unit line, is
 * recorded as a second unit"* — and a duplicate delivery of one scan are the
 * SAME BYTES on the wire. Nothing about the value distinguishes them. So a
 * primitive that dedupes on the payload silently records one unit when a packer
 * scans two identical ones, and the packer's own count says two.
 *
 * The answer is an id per GESTURE: two physical scans of the same barcode carry
 * two ids and are two units; a retry of one scan carries the id it already had
 * and is one. #2420 owns the sending; this owns the identity, and it is here now
 * because retrofitting identity under a shipped write path is a rewrite rather
 * than an addition.
 *
 * ## Durable BEFORE the consumer runs
 *
 * The id is written to storage and only then handed over. A tab reloaded
 * between the gesture and its acknowledgement therefore finds the id rather
 * than minting a second one for one physical act.
 *
 * `sessionStorage`, not `localStorage`: it is per tab and dies with it, and it
 * holds no credential — the `no-localstorage-jwt` rule is about tokens and is
 * not in tension with this. A storage that cannot be reached, or that refuses a
 * write, degrades to an in-memory log — in BOTH directions, which needs the
 * latch below rather than only a `try`/`catch`. The id stays unique per gesture,
 * which is the property that matters; only the survives-a-reload half is lost,
 * and it is lost honestly rather than by reading back a stale value.
 *
 * ## It is NOT cleared by the idle lock or a handover
 *
 * Story A3 — *"locking never discards progress"* — and a gesture already made is
 * progress. Who a REPLAYED gesture is attributed to is a real question and it is
 * #2420's, not this module's: nothing here sends anything.
 *
 * @module apps/web/src/features/bench/lib
 */

const STORAGE_KEY = 'ol.bench.pendingGestures';

/**
 * The most ids kept at once, oldest dropped first.
 *
 * A bound is required rather than tidy. #2418 is the first settler, so before
 * it a bench tab open for a shift grew this log by one entry per scan of the
 * day. Well above any plausible number of gestures in flight at once — which
 * matters now that there IS a settler, because an eviction that dropped an id a
 * retry still needed would let that retry mint a fresh one and the server record
 * a second unit for one physical scan (story G3, inverted).
 */
export const SCANNER_PENDING_LOG_LIMIT = 50;

/** A gesture that has been minted and not yet settled. */
export interface PendingGesture {
  readonly gestureId: string;
  readonly value: string;
  readonly at: number;
}

/** In-memory fallback, used whenever storage is unavailable OR refusing writes. */
let memoryLog: PendingGesture[] = [];

/**
 * Set once a write has failed, and never cleared.
 *
 * Without it the fallback covers only the case where `sessionStorage` cannot be
 * REACHED. A storage that exists but refuses `setItem` — a full quota, Safari's
 * private mode — leaves the in-memory copy correct and the stored copy stale, so
 * the next `read()` would return the STALE stored value and the id that was just
 * minted would vanish. Latching on the first failure makes the in-memory copy
 * authoritative from that moment, which is what the module's durability note
 * actually promises.
 */
let storageUnusable = false;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function read(): PendingGesture[] {
  const store = storage();
  if (store === null || storageUnusable) return memoryLog;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Coerced rather than trusted: this is storage a previous build wrote, and
    // a shape change must read as an empty log rather than throwing on the
    // packer's next scan.
    return parsed.filter((entry): entry is PendingGesture => {
      if (typeof entry !== 'object' || entry === null) return false;
      const record = entry as Record<string, unknown>;
      return (
        typeof record.gestureId === 'string' &&
        typeof record.value === 'string' &&
        typeof record.at === 'number'
      );
    });
  } catch {
    return [];
  }
}

function write(entries: PendingGesture[]): void {
  const bounded = entries.slice(-SCANNER_PENDING_LOG_LIMIT);
  memoryLog = bounded;
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // A full or refusing storage must never cost the packer a scan. The
    // in-memory copy above is already updated, and latching here is what makes
    // subsequent reads use it instead of the stale stored value.
    storageUnusable = true;
  }
}

/** A fresh id. Falls back to a counter where `crypto.randomUUID` is absent. */
let fallbackCounter = 0;
function mintId(): string {
  const maybeCrypto: Crypto | undefined = globalThis.crypto;
  if (typeof maybeCrypto?.randomUUID === 'function') return maybeCrypto.randomUUID();
  fallbackCounter += 1;
  return `gesture-${String(Date.now())}-${String(fallbackCounter)}`;
}

/**
 * Mint an id for one gesture and persist it BEFORE returning.
 *
 * The ordering is the contract: a caller receives an id that is already
 * durable, so it can never be handed one that a crash would erase.
 */
export function beginGesture(value: string, at: number): PendingGesture {
  const gesture: PendingGesture = { gestureId: mintId(), value, at };
  write([...read(), gesture]);
  return gesture;
}

/**
 * Forget a gesture once it has been accounted for.
 *
 * Called by whoever SENDS the gesture, since only they know when it has been
 * accounted for. #2418's verify mutation is the first: it settles once the
 * server has answered — verified, deduplicated or refused alike, all three
 * meaning the id has done its job — and settles nothing on a network failure,
 * which is the one case where the same id may legitimately be sent again.
 */
export function settleGesture(gestureId: string): void {
  write(read().filter((entry) => entry.gestureId !== gestureId));
}

/** Every gesture minted and not yet settled, oldest first. */
export function listPendingGestures(): readonly PendingGesture[] {
  return read();
}

/** Test seam. Not called by the product. */
export function resetGestureLogForTests(): void {
  memoryLog = [];
  storageUnusable = false;
  const store = storage();
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the in-memory copy is already cleared.
  }
}
