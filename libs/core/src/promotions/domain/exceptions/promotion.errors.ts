/**
 * Promotion Errors (#3935)
 *
 * The context's domain refusals. Each is its own type so the HTTP layer can map
 * them to distinct statuses.
 *
 * @module libs/core/src/promotions/domain/exceptions
 */
export class PromotionNotFoundError extends Error {
  constructor(public readonly promotionId: string) {
    super(`Promotion "${promotionId}" not found.`);
    this.name = 'PromotionNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** A promotion definition that does not narrow (condition, benefit or limits). */
export class PromotionInvalidError extends Error {
  constructor(
    public readonly part: 'condition' | 'benefit' | 'limits' | 'window' | 'name',
    public readonly index: number | null,
    detail: string,
  ) {
    super(`Invalid promotion ${part}${index === null ? '' : ` #${index}`}: ${detail}`);
    this.name = 'PromotionInvalidError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** An identical definition already covers an overlapping effective window. */
export class PromotionConflictError extends Error {
  constructor(
    public readonly definitionHash: string,
    public readonly conflictingPromotionId: string | null,
  ) {
    super(
      'A promotion with an identical definition already covers an overlapping date range' +
        (conflictingPromotionId === null ? '.' : ` (promotion ${conflictingPromotionId}).`),
    );
    this.name = 'PromotionConflictError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** A reorder must name every promotion exactly once. */
export class PromotionReorderMismatchError extends Error {
  constructor(
    public readonly missingPromotionIds: readonly string[],
    public readonly unknownPromotionIds: readonly string[],
  ) {
    super(
      `The order must list every promotion exactly once (missing: ${missingPromotionIds.length}, unknown or repeated: ${unknownPromotionIds.length}).`,
    );
    this.name = 'PromotionReorderMismatchError';
    Error.captureStackTrace(this, this.constructor);
  }
}
