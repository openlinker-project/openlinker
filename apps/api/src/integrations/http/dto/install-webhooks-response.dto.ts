/**
 * Install Webhooks Response DTO
 *
 * HTTP response shape for `POST /connections/:id/webhooks/install`. Mirrors
 * the core `WebhookProvisioningResult` (#583) but adds Swagger decorators so
 * the OpenAPI surface stays current. Lives in the API layer because it is
 * HTTP-specific (boundary concern, not domain).
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookProvisioningResult } from '@openlinker/core/integrations';

export class InstallWebhooksResponseDto {
  /**
   * Build the HTTP response shape from the neutral core result.
   * Mirrors `ConnectionTestResultDto.fromDomain` — keeps the domain → HTTP
   * boundary explicit so a future field on `WebhookProvisioningResult`
   * doesn't silently leak through structural typing.
   */
  static fromDomain(result: WebhookProvisioningResult): InstallWebhooksResponseDto {
    const dto = new InstallWebhooksResponseDto();
    dto.webhooksConfigured = result.webhooksConfigured;
    dto.testPingTriggered = result.testPingTriggered;
    if (result.warning !== undefined) {
      dto.warning = result.warning;
    }
    return dto;
  }

  @ApiProperty({
    description:
      'Whether OL has successfully pushed the webhook configuration to the ' +
      'external platform and recorded the success on the connection.',
  })
  webhooksConfigured!: boolean;

  @ApiProperty({
    description:
      'Whether the synchronous test ping round-trip succeeded. False if the ' +
      'platform ping endpoint was unreachable or the subsequent webhook ' +
      'delivery to OL failed; configuration is still valid in this case.',
  })
  testPingTriggered!: boolean;

  @ApiPropertyOptional({
    description:
      'Operator-actionable warning attached to partial-success states. ' +
      "Empty when both flags are true. Possible values: 'state-update-failed', " +
      "'ping-not-received'.",
  })
  warning?: string;
}
