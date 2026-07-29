/**
 * Update Analytics Consent DTO
 *
 * Represents a request to update the user's analytics consent preference.
 *
 * @module interfaces/http/dto
 */
import { IsBoolean } from 'class-validator';

export class UpdateAnalyticsConsentDto {
  @IsBoolean()
  analyticsConsent!: boolean;
}
