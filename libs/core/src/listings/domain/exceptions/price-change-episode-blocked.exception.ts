import type { PriceChangeBlockReason } from '../types/price-change-episode.types';

export class PriceChangeEpisodeBlockedException extends Error {
  constructor(
    public readonly episodeId: string,
    public readonly blockReason: PriceChangeBlockReason
  ) {
    super(`Price change episode ${episodeId} is blocked (${blockReason}) and cannot be accepted`);
    this.name = 'PriceChangeEpisodeBlockedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
