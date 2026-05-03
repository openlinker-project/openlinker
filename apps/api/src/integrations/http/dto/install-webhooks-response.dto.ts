/**
 * Install Webhooks Response DTO
 *
 * HTTP response shape for `POST /connections/:id/webhooks/install`. Mirrors
 * the `InstallWebhooksResult` returned by `PrestashopWebhookProvisioningService`
 * but adds Swagger decorators so the OpenAPI surface stays current. Lives in
 * the API layer because it is HTTP-specific (boundary concern, not domain).
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InstallWebhooksResponseDto {
  @ApiProperty({
    description:
      'Whether OL has successfully pushed the webhook configuration to the ' +
      'PS module via WS and recorded the success on the connection.',
  })
  webhooksConfigured!: boolean;

  @ApiProperty({
    description:
      'Whether the synchronous test ping round-trip succeeded. False if the ' +
      'PS module ping endpoint was unreachable or the subsequent webhook ' +
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
