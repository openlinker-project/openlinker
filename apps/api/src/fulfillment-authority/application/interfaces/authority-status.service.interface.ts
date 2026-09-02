/**
 * Authority Status Service Interface (#2353)
 *
 * @module apps/api/src/fulfillment-authority/application/interfaces
 */
import type { AuthorityPresetId } from '../authority-presets';
import type { AuthorityPresetPreview, AuthorityStatusView } from '../types/authority-status.types';

export const AUTHORITY_STATUS_SERVICE_TOKEN = Symbol('IAuthorityStatusService');

export interface IAuthorityStatusService {
  /** The seven answers, the inert states, and the preset catalogue. Never throws on config. */
  getStatus(): Promise<AuthorityStatusView>;

  /**
   * What a preset would change, computed IN MEMORY. Commits nothing.
   *
   * @throws BadRequestException if the preset is not available.
   */
  previewPreset(presetId: AuthorityPresetId): Promise<AuthorityPresetPreview>;

  /**
   * Apply a preset and return the resulting status.
   *
   * @throws BadRequestException if the preset is not available.
   * @throws UnprocessableEntityException if the RESULT would be ambiguous.
   */
  applyPreset(presetId: AuthorityPresetId): Promise<AuthorityStatusView>;
}
