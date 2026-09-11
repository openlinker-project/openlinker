export class PriceChangeEpisodeAlreadyResolvedException extends Error {
  constructor(public readonly episodeId: string) {
    super(`Price change episode already resolved: ${episodeId}`);
    this.name = 'PriceChangeEpisodeAlreadyResolvedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
