/**
 * Raised when a caller attempts to accept/edit/bulk-accept an episode that
 * ANOTHER caller has already claimed exclusive resolution rights over
 * (#3162 review, IMPORTANT — "nothing claims the episode at accept time").
 *
 * Distinct from `PriceChangeEpisodeAlreadyResolvedException`: this episode
 * is still open — its price has not yet been published — a peer's
 * accept/edit/bulk-accept call is simply in flight (the enqueued
 * `pricing.propagateToMarketplaces` job has not resolved it yet). Retrying
 * the identical request once that job completes will correctly answer
 * "already resolved" instead.
 *
 * @see PriceChangeEpisodeRepositoryPort.claimForResolution
 */
export class PriceChangeEpisodeInFlightException extends Error {
  constructor(public readonly episodeId: string) {
    super(`Price change episode ${episodeId} is already being resolved by another request`);
    this.name = 'PriceChangeEpisodeInFlightException';
    Error.captureStackTrace(this, this.constructor);
  }
}
