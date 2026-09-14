export class PriceChangeEpisodeNotFoundException extends Error {
  constructor(public readonly episodeId: string) {
    super(`Price change episode not found: ${episodeId}`);
    this.name = 'PriceChangeEpisodeNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
