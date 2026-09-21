/**
 * Assignment PATCH request DTO (#3337, ADR-074)
 *
 * Both fields are optional and independently applied — `undefined` means
 * "leave alone". `assignedToUserId` additionally distinguishes `null` (clear)
 * from a UUID (set/reassign): `@ValidateIf` skips `@IsUUID` when the value is
 * `null`, so a caller may send either without one shape failing the other
 * (the `pricing-sync-setting.dto.ts` precedent for a nullable-but-typed
 * field).
 *
 * The core service refuses a body naming NEITHER field
 * (`EmptyFulfillmentWorkAssignmentUpdateError`) — this DTO does not, because
 * "both absent" and "both explicitly omitted by a client that sent `{}`" are
 * indistinguishable at the transport layer, and the service's refusal already
 * covers it with a name a client can act on.
 *
 * @module apps/api/src/fulfillment/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class UpdateFulfillmentWorkAssignmentDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'A packer to pre-assign this parcel to, or null to clear an existing assignment. Omit to ' +
      'leave the current assignment untouched.',
  })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  assignedToUserId?: string | null;

  @ApiPropertyOptional({
    description:
      'Whether a packer other than assignedToUserId may still work this parcel. Omit to leave ' +
      'unchanged.',
  })
  @IsOptional()
  @IsBoolean()
  selfServeEligible?: boolean;
}
