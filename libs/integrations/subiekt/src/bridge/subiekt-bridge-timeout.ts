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
 * the far end stopped too. The cost is that a hung bridge holds a worker lane
 * slot for 150s rather than 30s, which is the right trade against a duplicated
 * fiscal document, and it is bounded because the bridge raises its own
 * TimeoutException first.
 *
 * @module libs/integrations/subiekt/src/bridge
 */
export const SUBIEKT_BRIDGE_TIMEOUT_MS = 150_000;
