/**
 * Order Column Preset Not Found Error (#3530)
 *
 * Raised both for a genuinely missing preset id AND for one that exists but
 * is owned by a different user — "personal: a user reads and writes only
 * their own" (AC). Collapsing the two into one refusal is deliberate: a 404
 * for "not yours" leaks nothing about which ids exist, unlike a 403 would.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderColumnPresetNotFoundError extends Error {
  constructor(public readonly presetId: string) {
    super(`Order column preset not found: ${presetId}`);
    this.name = 'OrderColumnPresetNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}
