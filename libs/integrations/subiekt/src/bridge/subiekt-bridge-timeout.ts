/**
 * Subiekt bridge HTTP timeout
 *
 * How long OpenLinker waits for the bridge, in ONE place, because the number is
 * only correct relative to the bridge's own budget and three clients were
 * carrying their own copy of it.
 *
 * It MUST exceed that budget. Otherwise a timeout at this end does not mean the
 * bridge gave up - it means OpenLinker stopped listening to a call that is
 * still running and will commit afterwards. The bridge states that directly:
 * "the bridge's own COM-side wait is NOT tied to the HTTP request's
 * cancellation, so a write OL gave up on can still commit later".
 *
 * Its Sfera budgets are 60s, 90s and 120s depending on the operation
 * (`Sfera.cs`), with a 150s warmup. At the previous 30s every create slower
 * than half a minute surfaced to OpenLinker as a transport failure while
 * succeeding in Subiekt - so the retry that followed was answering an outcome
 * that was never in doubt, and until the order key was made mandatory that
 * retry could write a second document.
 *
 * 150s is the bridge's own outer bound, so a timeout here now really does mean
 * the far end stopped too, and it is bounded anyway because the bridge raises
 * its own TimeoutException first.
 *
 * ## Two other numbers this one has to be compared against
 *
 * **The order-create lock TTL.** `order-create-lock.ts` serialises one
 * `(order, destination)` create and its docblock requires the TTL to comfortably
 * EXCEED the worst-case `createOrder` duration - which for Subiekt is this
 * value. It is 180s for that reason. Raising this constant past 180s without
 * raising that one inverts the lock's stated precondition: a create outliving
 * its own lock lets a peer attempt in, and exactly-once then rests entirely on
 * the bridge-side `orderRef` dedup rather than on OpenLinker's lock. That
 * fallback works - it is what the mandatory non-empty key exists for - but it
 * must be a deliberate arrangement rather than an accident of two files.
 *
 * **The `realtime` lane's per-scope cap.** `marketplace.order.sync` runs on
 * `realtime`, whose defaults are `{total: 4, perScope: 2}` (ADR-050, still
 * marked illustrative pending #1134). So TWO concurrent slow Subiekt creates
 * hold that connection's ENTIRE realtime allowance for two and a half minutes -
 * not one slot of several - and everything else on that connection waits behind
 * them, including webhook-driven product syncs and OMS dispatch. #2613's
 * penalty-free deferral does not help: a client-side timeout is neither a 429
 * nor a 503, so it spends a real retry attempt. An operator watching a Subiekt
 * connection go quiet for minutes is looking at this paragraph.
 *
 * The trade is still the right one - a duplicated fiscal document is worse than
 * a stalled lane - but the cost is two slots for 150s, and that is worth
 * writing down rather than implying.
 *
 * @module libs/integrations/subiekt/src/bridge
 */
export const SUBIEKT_BRIDGE_TIMEOUT_MS = 150_000;
