/**
 * Rate Limit Policy Rules
 *
 * Pure rules over `ConnectionRateLimit` that more than one reader needs: the
 * transport (`HttpTransportFactory`) applies them to the call it is about to
 * pace, and the host's status read (`RateLimitStatusService`) applies the SAME
 * function to the number it shows the operator, so what is reported and what
 * is enforced cannot drift apart.
 *
 * @module libs/shared/src/rate-limit
 */
import type { ConnectionRateLimit } from './rate-limiter.types';

function stricter(ceiling: number | undefined, override: number | undefined): number | undefined {
  if (ceiling === undefined) return override;
  if (override === undefined) return ceiling;
  return Math.min(ceiling, override);
}

/**
 * The policy one connection may use against a bucket it SHARES with other
 * connections (ADR-038 § Amendment: shared remote quota).
 *
 * `ceiling` is the platform's own budget for the shared remote (the plugin's
 * `defaultRateLimit`), `override` is the connection's operator-set
 * `config.rateLimit`. Each knob resolves to the stricter of the two, and an
 * undefined knob on either side means "this side sets no limit here" - so an
 * override can add a limit the ceiling lacks, and can lower one it has, but can
 * never raise one. One connection's generous config must not loosen a budget
 * every other connection to the same remote is also drawing from.
 */
export function tightenRateLimit(
  ceiling: ConnectionRateLimit | undefined,
  override: ConnectionRateLimit | undefined
): ConnectionRateLimit {
  return {
    requestsPerMinute: stricter(ceiling?.requestsPerMinute, override?.requestsPerMinute),
    maxConcurrent: stricter(ceiling?.maxConcurrent, override?.maxConcurrent),
  };
}
