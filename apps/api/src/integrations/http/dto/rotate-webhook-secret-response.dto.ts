/**
 * Rotate Webhook Secret Response DTO
 *
 * Response body for webhook secret rotation. The plaintext secret is returned
 * exactly once here and never retrievable afterwards — callers must store it
 * immediately.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class RotateWebhookSecretResponseDto {
  @ApiProperty({ description: 'Plaintext webhook secret. Shown only once.' })
  secret!: string;

  @ApiProperty({ description: 'Always true. Marks this secret as reveal-on-creation.' })
  revealedOnce!: boolean;

  @ApiProperty({ description: 'Operator warning describing the reveal-once semantics.' })
  warning!: string;
}
