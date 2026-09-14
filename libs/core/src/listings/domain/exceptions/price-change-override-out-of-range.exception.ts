import type { PriceOverrideBoundOutcome } from '../types/price-override-bound.types';

/**
 * A manual price override too far from the rule-computed price to be
 * plausible (#3222). Mapped to 422 — the request is well-formed and the
 * episode is actionable; the VALUE is refused. 400 on this route is already
 * taken by DTO-shape failures.
 */
export class PriceChangeOverrideOutOfRangeException extends Error {
  constructor(
    public readonly episodeId: string,
    public readonly outcome: Exclude<PriceOverrideBoundOutcome, 'ok'>,
    public readonly attempted: number,
    public readonly computedAmount: number,
    public readonly limit: number
  ) {
    super(
      `Price override ${attempted} is ${outcome === 'too-high' ? 'above' : 'below'} the ` +
        `${outcome === 'too-high' ? 'maximum' : 'minimum'} of ${limit} for episode ${episodeId} ` +
        `(rule-computed price ${computedAmount}). Correct the price, or change the pricing rule ` +
        `on the destination connection if the computed price itself is wrong.`
    );
    this.name = 'PriceChangeOverrideOutOfRangeException';
    Error.captureStackTrace(this, this.constructor);
  }
}
