/**
 * Offer Creation Request Payload Response DTO
 *
 * Debug-only response-shape sibling of `CreateOfferDto`. Rendered on the
 * status response (`GET /listings/connections/:connectionId/offers/creation/:id`)
 * so the frontend can pre-fill the wizard on retry (#307).
 *
 * Separate from the request DTO so `class-validator` decorators don't leak
 * onto the response path where they're dead weight. Pure `@ApiProperty` /
 * `@ApiPropertyOptional` annotations here — responses describe shape for
 * Swagger, not validate inbound input.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OfferCreationRequestPriceResponseDto {
  @ApiProperty({ example: 99.99 })
  amount!: number;

  @ApiProperty({ example: 'PLN' })
  currency!: string;
}

export class OfferCreationRequestOverridesResponseDto {
  @ApiPropertyOptional({ description: 'Offer title override the operator submitted' })
  title?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Offer description override; `null` means "no override" was supplied',
  })
  description?: string | null;

  @ApiPropertyOptional({ description: 'Platform-specific category id the operator selected' })
  categoryId?: string;

  @ApiPropertyOptional({
    nullable: true,
    isArray: true,
    type: String,
    description: 'Image URLs the operator submitted',
  })
  imageUrls?: string[] | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Platform-specific params (e.g. `deliveryPolicyId`, `warrantyId` for Allegro)',
  })
  platformParams?: Record<string, unknown>;
}

export class OfferCreationRequestPayloadDto {
  @ApiProperty({
    description: 'Snapshot schema version. Readers route on this value; unknown versions degrade to null.',
    example: 1,
  })
  schemaVersion!: number;

  @ApiProperty({ description: 'OpenLinker internal variant id this create-attempt targeted' })
  internalVariantId!: string;

  @ApiProperty({ description: 'Stock quantity the operator submitted' })
  stock!: number;

  @ApiProperty({ description: 'Whether the operator asked to publish immediately' })
  publishImmediately!: boolean;

  @ApiPropertyOptional({ type: OfferCreationRequestPriceResponseDto })
  price?: OfferCreationRequestPriceResponseDto;

  @ApiPropertyOptional({ type: OfferCreationRequestOverridesResponseDto })
  overrides?: OfferCreationRequestOverridesResponseDto;
}
